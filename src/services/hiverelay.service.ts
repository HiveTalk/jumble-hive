import {
  HIVERELAY_ACTION_KIND,
  HIVERELAY_API_BASE,
  HIVERELAY_ROOM_ANNOUNCEMENT_KIND
} from '@/constants'
import {
  THiveRelayChallenge,
  THiveRelayGateError,
  THiveRelayGetTokenRequest,
  THiveRelayGetTokenResponse,
  THiveRelayInvoice,
  THiveRelayOwnedRoom,
  THiveRelayPaymentStatusResponse,
  THiveRelayPlanId,
  THiveRelayPlansResponse,
  THiveRelayRegisteredRoom,
  THiveRelayRoomDeleteResponse,
  THiveRelayRoomInfo,
  THiveRelayRoomSummary,
  THiveRelaySubscription
} from '@/types/hiverelay'
import { ISigner } from '@/types'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'

type TAction =
  | 'subscribe'
  | 'create-room'
  | 'edit-room'
  | 'delete-room'
  | 'payment-status'
  | 'subscription'

/**
 * HiveRelay — a Nostr relay (NIP-42/NIP-53) that fronts LiveKit, owns the room
 * registry, and mints LiveKit access tokens. This service talks to its REST
 * API using the active Nostr signer for both NIP-98 and HiveRelay's "action
 * event" challenge flow.
 *
 * Two auth mechanisms:
 *  - Mechanism A (action events, header-based + challenge): used by
 *    /api/subscribe, /api/payment/status, /api/subscription, /api/register-room
 *  - Mechanism B (body-based signed event): used by /api/get-token ONLY
 *
 * All endpoints on premrelay.exe.xyz serve CORS with allow-origin: *, so the
 * browser calls the relay directly.
 */
class HiveRelayService {
  static instance: HiveRelayService

  constructor() {
    if (!HiveRelayService.instance) {
      HiveRelayService.instance = this
    }
    return HiveRelayService.instance
  }

  private get signer(): ISigner {
    // Access the signer from the client service at call time so it always
    // reflects the currently logged-in account.
    const signer = client.signer
    if (!signer) {
      throw new Error('Please login first to use HiveRelay video rooms')
    }
    return signer
  }

  async getPublicKey(): Promise<string> {
    return this.signer.getPublicKey()
  }

  // ---- Signing helpers -------------------------------------------------

  /** Hex SHA-256 of the exact raw request body (empty string for a bodyless GET). */
  private hashBody(body: string): string {
    return bytesToHex(sha256(new TextEncoder().encode(body)))
  }

  /**
   * Mechanism B — Build and sign a kind-27235 event for /api/get-token.
   * The signed event JSON (raw, NOT base64) is carried in
   * attributes.signed_event in the request body. Only `u` and `method` tags
   * are needed — no action, nonce, or payload tags.
   */
  private async signGetTokenEvent(url: string, method: string): Promise<string> {
    const event = await this.signer.signEvent({
      kind: HIVERELAY_ACTION_KIND,
      created_at: dayjs().unix(),
      content: '',
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return JSON.stringify(event)
  }

  /**
   * Mechanism A — Build and sign a kind-27235 *action* event: like NIP-98 but
   * with extra `action` and `nonce` tags, and a `payload` tag (empty-string
   * hash for a bodyless GET). The `nonce` is proven by echoing the challenge
   * JWT in the X-Challenge header. Returns the Authorization header value.
   */
  private async signActionEvent(
    url: string,
    method: string,
    body: string,
    action: TAction,
    nonce: string
  ): Promise<string> {
    const event = await this.signer.signEvent({
      kind: HIVERELAY_ACTION_KIND,
      created_at: dayjs().unix(),
      content: '',
      tags: [
        ['payload', this.hashBody(body)],
        ['action', action],
        ['nonce', nonce],
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  // ---- Low-level request helpers --------------------------------------

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(path, HIVERELAY_API_BASE)
    if (query) {
      Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
    }
    return url.toString()
  }

  private parseGate(body: string): THiveRelayGateError | undefined {
    try {
      const parsed = JSON.parse(body) as THiveRelayGateError
      if (parsed && (parsed.error || parsed.reason)) return parsed
    } catch {
      // not JSON
    }
    return undefined
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      query?: Record<string, string>
      body?: unknown
      auth?: string
      challenge?: string
    } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query)
    const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (opts.auth) headers['Authorization'] = opts.auth
    if (opts.challenge) headers['X-Challenge'] = opts.challenge

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: rawBody || undefined
      })
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : 'Network error'
      throw new HiveRelayError(`Could not reach HiveRelay: ${detail}`, 0)
    }

    const text = await res.text()

    if (!res.ok) {
      const gate = this.parseGate(text)
      const message =
        gate?.error ??
        (text && text.trim() ? text.trim() : undefined) ??
        res.statusText ??
        `Request failed (${res.status})`
      throw new HiveRelayError(message, res.status, gate)
    }

    if (res.status === 204 || !text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined as T
    }
  }

  /**
   * Runs an action-event request end to end: fetch a fresh challenge, sign the
   * action event with its nonce, and send the request with both headers. A
   * fresh challenge is needed per call (nonces are single-use, expire in 5 min).
   */
  private async actionRequest<T>(
    method: string,
    path: string,
    action: TAction,
    opts: { query?: Record<string, string>; body?: unknown } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query)
    const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const { nonce, challenge } = await this.getChallenge()
    const auth = await this.signActionEvent(url, method, rawBody, action, nonce)
    return this.request<T>(method, path, {
      query: opts.query,
      body: opts.body,
      auth,
      challenge
    })
  }

  // ---- Public API ------------------------------------------------------

  /** GET /api/auth/challenge → {challenge, nonce, expires_at, domain} */
  async getChallenge(): Promise<THiveRelayChallenge> {
    return this.request<THiveRelayChallenge>('GET', '/api/auth/challenge')
  }

  /** GET /api/plans — plan ids, sat prices, room quotas. Public. */
  async getPlans(): Promise<THiveRelayPlansResponse> {
    return this.request<THiveRelayPlansResponse>('GET', '/api/plans')
  }

  /**
   * POST /api/subscribe {plan} with action="subscribe". Returns a BOLT11
   * invoice bound to the caller's pubkey and plan. At most one pending invoice
   * per pubkey; asking again returns the same one (409 pending_invoice).
   */
  async subscribe(plan: THiveRelayPlanId): Promise<THiveRelayInvoice> {
    return this.actionRequest<THiveRelayInvoice>('POST', '/api/subscribe', 'subscribe', {
      body: { plan }
    })
  }

  /**
   * GET /api/payment/status?id=<intent_id> with action="payment-status". Poll
   * until status === 'settled'. Re-verifies settlement with the provider on
   * each read; safe to call repeatedly. Resolves with the subscription once
   * settled. Rejects on expired/failed.
   */
  async getPaymentStatus(intentId: string): Promise<THiveRelayPaymentStatusResponse> {
    return this.actionRequest<THiveRelayPaymentStatusResponse>(
      'GET',
      '/api/payment/status',
      'payment-status',
      { query: { id: intentId } }
    )
  }

  /**
   * Polls getPaymentStatus at a fixed interval until the intent settles,
   * expires or fails, or the timeout elapses. Returns the final status
   * response (with subscription populated once settled), or throws on terminal
   * failure.
   */
  async pollPaymentUntilSettled(
    intentId: string,
    opts: {
      intervalMs?: number
      timeoutMs?: number
      onPoll?: (s: THiveRelayPaymentStatusResponse) => void
    } = {}
  ): Promise<THiveRelayPaymentStatusResponse> {
    const intervalMs = opts.intervalMs ?? 3000
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000
    const deadline = Date.now() + timeoutMs
    let last: THiveRelayPaymentStatusResponse | undefined
    while (Date.now() < deadline) {
      last = await this.getPaymentStatus(intentId)
      opts.onPoll?.(last)
      if (last.status === 'settled') return last
      if (last.status === 'expired' || last.status === 'failed') {
        throw new HiveRelayError(`Payment ${last.status}`, 402)
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new HiveRelayError('Payment polling timed out', 408)
  }

  /** GET /api/subscription — the caller's current entitlement. action="subscription". */
  async getSubscription(): Promise<THiveRelaySubscription> {
    return this.actionRequest<THiveRelaySubscription>('GET', '/api/subscription', 'subscription')
  }

  /**
   * POST /api/register-room {room_name, event?} with action="create-room" →
   * 201. Creates the registry row that makes a room permanent (owner, immutable
   * room_id, privacy flag). The caller's pubkey is the owner.
   *
   * When announce is true (default), a kind-30312 room announcement is signed
   * and embedded in the body's event field so the relay persists it alongside
   * the registry row.
   */
  async registerRoom(roomName: string, announce = true): Promise<THiveRelayRegisteredRoom> {
    let event: Event | undefined
    if (announce) {
      try {
        event = await this.signer.signEvent({
          kind: HIVERELAY_ROOM_ANNOUNCEMENT_KIND,
          created_at: dayjs().unix(),
          content: '',
          tags: [
            ['d', roomName],
            ['title', roomName],
            ['room', roomName],
            ['status', 'live'],
            ['t', 'hiverelay']
          ]
        })
      } catch {
        // Signing the 30312 is best-effort; the room can be registered without it.
      }
    }
    const body: { room_name: string; event?: Event } = { room_name: roomName }
    if (event) body.event = event
    return this.actionRequest<THiveRelayRegisteredRoom>(
      'POST',
      '/api/register-room',
      'create-room',
      { body }
    )
  }

  /**
   * POST /api/get-token {roomName, participantName, pubkey, attributes} —
   * returns the LiveKit JWT and websocket URL. Connect a LiveKit client SDK to
   * url with token. A 403 room_not_registered means the name has no registry
   * row (ephemeral).
   *
   * Uses Mechanism B: the kind-27235 signed event is carried in
   * attributes.signed_event inside the JSON body (raw JSON string, NOT
   * base64). No Authorization header, no X-Challenge. The event needs only
   * u and method tags — no payload, action, or nonce.
   */
  async getToken(req: THiveRelayGetTokenRequest): Promise<THiveRelayGetTokenResponse> {
    const url = this.buildUrl('/api/get-token')
    const signedEvent = await this.signGetTokenEvent(url, 'POST')
    const pubkey = await this.getPublicKey()
    return this.request<THiveRelayGetTokenResponse>('POST', '/api/get-token', {
      body: {
        ...req,
        pubkey,
        attributes: {
          ...(req.attributes ?? {}),
          signed_event: signedEvent
        }
      }
    })
  }

  /**
   * POST /api/room/delete {room_name, confirm} — owner-only cascade delete.
   * Uses the LiveKit owner JWT as Bearer auth (not the action-event mechanism).
   * `confirm` must echo `room_name` as a safety check. The LiveKit room, access
   * policies, stage membership, polls and the Nostr announcement are all deleted.
   * Recordings are preserved.
   */
  async deleteRoom(roomName: string): Promise<THiveRelayRoomDeleteResponse> {
    // Get a LiveKit token for the room — for the owner, this token has the
    // owner claim set to true, which is what the delete endpoint authenticates.
    const participantName = (await this.getPublicKey()).slice(0, 8)
    const { token } = await this.getToken({
      roomName,
      participantName,
      pubkey: await this.getPublicKey()
    })

    return this.request<THiveRelayRoomDeleteResponse>('POST', '/api/room/delete', {
      body: { room_name: roomName, confirm: roomName },
      auth: `Bearer ${token}`
    })
  }

  /** GET /api/room-info?room_name= — resolve a name to canonical metadata. 404 = unregistered. */
  async getRoomInfo(roomName: string): Promise<THiveRelayRoomInfo | null> {
    try {
      return await this.request<THiveRelayRoomInfo>('GET', '/api/room-info', {
        query: { room_name: roomName }
      })
    } catch (e) {
      if (e instanceof HiveRelayError && e.status === 404) return null
      throw e
    }
  }

  /** GET /api/rooms-by-pubkey?pubkey= — rooms owned by a pubkey (from the registry). */
  async getRoomsByPubkey(pubkey: string): Promise<THiveRelayOwnedRoom[]> {
    return this.request<THiveRelayOwnedRoom[]>('GET', '/api/rooms-by-pubkey', {
      query: { pubkey }
    })
  }

  /** GET /api/list-rooms — live LiveKit rooms with metadata. Public. */
  async listRooms(): Promise<THiveRelayRoomSummary[]> {
    return this.request<THiveRelayRoomSummary[]>('GET', '/api/list-rooms')
  }
}

export class HiveRelayError extends Error {
  status: number
  gate?: THiveRelayGateError

  constructor(message: string, status: number, gate?: THiveRelayGateError) {
    super(message)
    this.name = 'HiveRelayError'
    this.status = status
    this.gate = gate
  }
}

// Late-import client to avoid a circular dependency at module load time.
// client.signer is read lazily inside the getter above.
import client from './client.service'

const instance = new HiveRelayService()
export default instance
