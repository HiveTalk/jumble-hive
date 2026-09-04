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
  THiveRelayLockResponse,
  THiveRelayOwnedRoom,
  THiveRelayPaymentStatusResponse,
  THiveRelayPlanId,
  THiveRelayPlansResponse,
  THiveRelayRecordingDownloadResponse,
  THiveRelayRecordingListResponse,
  THiveRelayRecordingStartResponse,
  THiveRelayRecordingStatus,
  THiveRelayRecordingStopResponse,
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
import lightningService from '@/services/lightning.service'

type TL402Proof = { macaroon: string; preimage: string }

type TSubscribeResponse = {
  res: Response
  text: string
  body?: THiveRelayPaymentStatusResponse & { error?: string }
}

const L402_PROOF_STORAGE_PREFIX = 'hiverelay.l402.proof.'

/**
 * States the relay will never move away from. A proof for an intent in one of
 * these is worthless: replaying it can only fail, so it must be dropped or the
 * user is locked out of buying a fresh invoice.
 */
type TTerminalPaymentStatus = 'expired' | 'failed'
const TERMINAL_PAYMENT_STATUSES: TTerminalPaymentStatus[] = ['expired', 'failed']

const isTerminalPaymentStatus = (status: string): status is TTerminalPaymentStatus =>
  (TERMINAL_PAYMENT_STATUSES as string[]).includes(status)

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
 * All endpoints on the HiveRelay serve CORS with allow-origin: *, so the
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

  // ---- L402 helpers ----------------------------------------------------

  private parseL402Header(header: string | null): { macaroon: string; invoice: string } | null {
    const prefix = 'L402 '
    if (!header || !header.startsWith(prefix)) return null
    const rest = header.slice(prefix.length)
    const macaroonMatch = /macaroon="([^"]+)"/.exec(rest)
    const invoiceMatch = /invoice="([^"]+)"/.exec(rest)
    if (!macaroonMatch || !invoiceMatch) return null
    return { macaroon: macaroonMatch[1], invoice: invoiceMatch[1] }
  }

  /**
   * The challenge also travels in the 402 body, which is the only copy a
   * cross-origin caller can rely on: `WWW-Authenticate` is not a CORS-safelisted
   * response header, so it is invisible unless the relay lists it in
   * `Access-Control-Expose-Headers`.
   */
  private parseL402Body(body: unknown): { macaroon: string; invoice: string } | null {
    if (!body || typeof body !== 'object') return null
    const record = body as Record<string, unknown>
    const macaroon = record.macaroon
    const invoice = record.invoice ?? record.bolt11
    if (typeof macaroon !== 'string' || typeof invoice !== 'string') return null
    if (!macaroon || !invoice) return null
    return { macaroon, invoice }
  }

  private l402AuthHeader(macaroon: string, preimage: string): string {
    return `L402 ${macaroon}:${preimage}`
  }

  private l402ProofKey(pubkey: string, plan: THiveRelayPlanId): string {
    return `${L402_PROOF_STORAGE_PREFIX}${pubkey}:${plan}`
  }

  /**
   * Proofs of a *paid but unredeemed* invoice. They outlive the page so a
   * failed or interrupted redeem can be replayed instead of paying again, and
   * are dropped as soon as the relay reports a state it will not move away
   * from — settled, expired or failed. See `settleSubscribe`.
   */
  private readL402Proof(pubkey: string, plan: THiveRelayPlanId): TL402Proof | null {
    try {
      const raw = window.localStorage.getItem(this.l402ProofKey(pubkey, plan))
      const proof = raw ? this.parseJson<TL402Proof>(raw) : undefined
      if (!proof?.macaroon || !proof?.preimage) return null
      return proof
    } catch {
      return null
    }
  }

  private saveL402Proof(pubkey: string, plan: THiveRelayPlanId, proof: TL402Proof): void {
    try {
      window.localStorage.setItem(this.l402ProofKey(pubkey, plan), JSON.stringify(proof))
    } catch {
      // Storage unavailable (private mode, quota): the in-flight redeem below
      // is then the only attempt we get.
    }
  }

  private clearL402Proof(pubkey: string, plan: THiveRelayPlanId): void {
    try {
      window.localStorage.removeItem(this.l402ProofKey(pubkey, plan))
    } catch {
      // ignore
    }
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

  /** Same-origin billing proxy so the browser can read the L402 WWW-Authenticate header. */
  private buildBillingProxyUrl(path: string, query?: Record<string, string>): string {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : (import.meta.env.VITE_DEV_ORIGIN as string | undefined) ?? 'http://localhost:5173'
    const params = new URLSearchParams()
    params.set('path', path)
    if (query) {
      Object.entries(query).forEach(([k, v]) => params.set(k, v))
    }
    return `${origin}/api/billing/proxy?${params.toString()}`
  }

  /** JSON.parse that yields undefined instead of throwing on a non-JSON body. */
  private parseJson<T>(text: string): T | undefined {
    if (!text) return undefined
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined
    }
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

  /**
   * Billing endpoints return an L402 challenge in a `WWW-Authenticate` header,
   * which is hidden from cross-origin JS.  We sign for the relay URL but POST
   * through a same-origin proxy so the browser can read the response header.
   */
  private async billingActionRequest<T>(
    method: string,
    path: string,
    action: TAction,
    opts: { query?: Record<string, string>; body?: unknown } = {}
  ): Promise<T> {
    const relayUrl = this.buildUrl(path, opts.query)
    const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : ''
    const { nonce, challenge } = await this.getChallenge()
    const auth = await this.signActionEvent(relayUrl, method, rawBody, action, nonce)
    const proxyUrl = this.buildBillingProxyUrl(path, opts.query)
    return this.request<T>(method, proxyUrl, {
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
   * One signed POST /api/subscribe attempt, optionally carrying an L402 proof.
   * Each attempt needs its own challenge because nonces are single-use.
   *
   * The action event is signed for the relay URL (the relay verifies the `u`
   * tag against its own host), but the request is sent through the same-origin
   * billing proxy so the browser can read the L402 `WWW-Authenticate` header,
   * which is not CORS-safelisted.
   */
  private async postSubscribe(
    path: string,
    rawBody: string,
    proof?: TL402Proof
  ): Promise<TSubscribeResponse> {
    const relayUrl = this.buildUrl(path)
    const { nonce, challenge } = await this.getChallenge()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: await this.signActionEvent(relayUrl, 'POST', rawBody, 'subscribe', nonce),
      'X-Challenge': challenge
    }
    if (proof) headers['X-L402'] = this.l402AuthHeader(proof.macaroon, proof.preimage)

    const proxyUrl = this.buildBillingProxyUrl(path)
    let res: Response
    try {
      res = await fetch(proxyUrl, { method: 'POST', headers, body: rawBody })
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message : 'Network error'
      throw new HiveRelayError(`Could not reach HiveRelay: ${detail}`, 0)
    }
    const text = await res.text()
    return {
      res,
      text,
      body: this.parseJson<THiveRelayPaymentStatusResponse & { error?: string }>(text)
    }
  }

  /**
   * POST /api/subscribe {plan} with action="subscribe". The relay now returns
   * an L402 402 challenge. We pay the invoice, obtain the preimage, and retry
   * the signed action event with the L402 proof in the X-L402 header (the
   * standard Authorization header is already used for the Nostr action event).
   * The proof survives a failed redeem so it can be replayed, and a `pending`
   * response is polled to settlement — a paid invoice is never thrown away.
   */
  async subscribe(plan: THiveRelayPlanId): Promise<THiveRelayPaymentStatusResponse> {
    const path = '/api/subscribe'
    const rawBody = JSON.stringify({ plan })
    const pubkey = await this.getPublicKey()

    // A proof is only stored when its invoice was paid but the redeeming
    // request never confirmed a subscription. Replay it before asking for a
    // new challenge so an interrupted retry cannot cost a second invoice.
    const stored = this.readL402Proof(pubkey, plan)
    if (stored) {
      const replay = await this.postSubscribe(path, rawBody, stored)
      if (replay.res.ok && replay.body) {
        return this.settleSubscribe(pubkey, plan, replay.body)
      }
      // The relay would not honour it (expired, already spent, malformed):
      // drop it and buy a fresh invoice below.
      this.clearL402Proof(pubkey, plan)
    }

    const { res, text, body } = await this.postSubscribe(path, rawBody)

    if (res.status === 402) {
      const l402 =
        this.parseL402Header(res.headers.get('WWW-Authenticate')) ?? this.parseL402Body(body)
      if (!l402) {
        throw new HiveRelayError(
          'HiveRelay asked for payment but sent no L402 invoice we could read',
          402
        )
      }
      const paid = await lightningService.payInvoice(l402.invoice)
      if (!paid?.preimage) {
        // The user closed the wallet without paying. Cancel the pending intent
        // so the next plan choice is not blocked by the one-pending-invoice rule.
        if (body?.intent_id) {
          try {
            await this.cancelPayment(body.intent_id)
          } catch {
            // Best-effort cancellation; the payment was already cancelled.
          }
        }
        throw new HiveRelayError('Payment cancelled', 402)
      }
      // Persist before redeeming: from here on the sats are spent, and the
      // macaroon + preimage are the only way to claim what they bought.
      const proof = { macaroon: l402.macaroon, preimage: paid.preimage }
      this.saveL402Proof(pubkey, plan, proof)

      const retry = await this.postSubscribe(path, rawBody, proof)
      if (!retry.res.ok || !retry.body) {
        const gate = this.parseGate(retry.text)
        const detail =
          (gate?.error ?? retry.body?.error ?? retry.text.trim()) || retry.res.statusText
        throw new HiveRelayError(
          `Payment sent but HiveRelay did not confirm the subscription: ${detail}. The payment proof is saved — subscribing again redeems it instead of paying a second invoice.`,
          retry.res.status,
          gate
        )
      }
      return this.settleSubscribe(pubkey, plan, retry.body)
    }

    if (!res.ok) {
      const gate = this.parseGate(text)
      const message = (gate?.error ?? body?.error ?? text.trim()) || res.statusText
      throw new HiveRelayError(message, res.status, gate)
    }
    if (!body) {
      throw new HiveRelayError('HiveRelay returned an unreadable payment response', res.status)
    }
    return body
  }

  /**
   * Resolves a redeemed L402 payment to its final state: the relay may answer
   * `pending` while it reconciles settlement, so poll it out rather than report
   * failure for an invoice that is already paid.
   *
   * The proof is discarded on any state the relay will not move away from —
   * `settled` (it did its job) as well as `expired`/`failed` (it never will).
   * Keeping a dead proof would make every later subscribe replay it forever
   * instead of buying a new invoice. It is kept only when the outcome is
   * genuinely unknown (polling timeout, network error), which is the case this
   * storage exists for.
   */
  private async settleSubscribe(
    pubkey: string,
    plan: THiveRelayPlanId,
    body: THiveRelayPaymentStatusResponse
  ): Promise<THiveRelayPaymentStatusResponse> {
    let result = body
    if (result.status === 'pending' && result.intent_id) {
      try {
        result = await this.pollPaymentUntilSettled(result.intent_id, {
          intervalMs: 3000,
          timeoutMs: 10 * 60 * 1000
        })
      } catch (e) {
        if (e instanceof HiveRelayError && e.paymentStatus) {
          this.clearL402Proof(pubkey, plan)
        }
        throw e
      }
    }
    if (result.status === 'settled' || isTerminalPaymentStatus(result.status)) {
      this.clearL402Proof(pubkey, plan)
    }
    return result
  }

  /**
   * GET /api/payment/status?id=<intent_id> with action="payment-status". Poll
   * until status === 'settled'. Re-verifies settlement with the provider on
   * each read; safe to call repeatedly. Resolves with the subscription once
   * settled. Rejects on expired/failed.
   */
  async getPaymentStatus(intentId: string): Promise<THiveRelayPaymentStatusResponse> {
    return this.billingActionRequest<THiveRelayPaymentStatusResponse>(
      'GET',
      '/api/payment/status',
      'payment-status',
      { query: { id: intentId } }
    )
  }

  /**
   * DELETE /api/payment/status?id=<intent_id> with action="payment-status".
   * Cancels a still-pending intent. The relay re-checks settlement first, so a
   * payment that reached the provider just before dismissal is not discarded.
   * Returns the final intent state (failed if cancelled, settled if it paid).
   */
  async cancelPayment(intentId: string): Promise<THiveRelayPaymentStatusResponse> {
    return this.billingActionRequest<THiveRelayPaymentStatusResponse>(
      'DELETE',
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
      if (isTerminalPaymentStatus(last.status)) {
        throw new HiveRelayError(`Payment ${last.status}`, 402, undefined, last.status)
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new HiveRelayError('Payment polling timed out', 408)
  }

  /** GET /api/subscription — the caller's current entitlement. action="subscription". */
  async getSubscription(): Promise<THiveRelaySubscription> {
    return this.billingActionRequest<THiveRelaySubscription>(
      'GET',
      '/api/subscription',
      'subscription'
    )
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

  // ---- Room lock ---------------------------------------------------------

  /**
   * POST /api/room/notify-lock {room_name, locked} — owner/moderator only.
   * Uses the LiveKit JWT as Bearer auth, same mechanism as `deleteRoom`. New
   * participants cannot join a locked room; existing participants stay
   * connected. Broadcasts an `lk.roomlock` data message to the room so other
   * clients can react live.
   */
  async setRoomLock(
    token: string,
    roomName: string,
    locked: boolean
  ): Promise<THiveRelayLockResponse> {
    return this.request<THiveRelayLockResponse>('POST', '/api/room/notify-lock', {
      body: { room_name: roomName, locked },
      auth: `Bearer ${token}`
    })
  }

  // ---- Recording ----------------------------------------------------------

  /** POST /api/room/recording/start {roomName} — owner-only. Bearer <LiveKit JWT>. */
  async startRecording(token: string, roomName: string): Promise<THiveRelayRecordingStartResponse> {
    return this.request<THiveRelayRecordingStartResponse>('POST', '/api/room/recording/start', {
      body: { roomName },
      auth: `Bearer ${token}`
    })
  }

  /** POST /api/room/recording/stop {roomName} — owner-only. Bearer <LiveKit JWT>. */
  async stopRecording(token: string, roomName: string): Promise<THiveRelayRecordingStopResponse> {
    return this.request<THiveRelayRecordingStopResponse>('POST', '/api/room/recording/stop', {
      body: { roomName },
      auth: `Bearer ${token}`
    })
  }

  /**
   * GET /api/room/recording/status?roomName= — public pre-join read, no auth
   * required. Used to poll the elapsed-time indicator while recording.
   */
  async getRecordingStatus(roomName: string): Promise<THiveRelayRecordingStatus> {
    return this.request<THiveRelayRecordingStatus>('GET', '/api/room/recording/status', {
      query: { roomName }
    })
  }

  /** GET /api/room/recording/list?roomName= — owner-only. Bearer <LiveKit JWT>. */
  async listRecordings(token: string, roomName: string): Promise<THiveRelayRecordingListResponse> {
    return this.request<THiveRelayRecordingListResponse>('GET', '/api/room/recording/list', {
      query: { roomName },
      auth: `Bearer ${token}`
    })
  }

  /**
   * GET /api/room/recording/download?roomName=&id= — mints a fresh presigned
   * download URL. Only needed when a list row's `download_url` is missing or
   * has expired (`download_expires_at` in the past).
   */
  async getRecordingDownloadUrl(
    token: string,
    roomName: string,
    id: string
  ): Promise<THiveRelayRecordingDownloadResponse> {
    return this.request<THiveRelayRecordingDownloadResponse>('GET', '/api/room/recording/download', {
      query: { roomName, id },
      auth: `Bearer ${token}`
    })
  }

  /** DELETE /api/room/recording/delete?roomName=&id= — owner-only. Bearer <LiveKit JWT>. */
  async deleteRecording(token: string, roomName: string, id: string): Promise<void> {
    await this.request<void>('DELETE', '/api/room/recording/delete', {
      query: { roomName, id },
      auth: `Bearer ${token}`
    })
  }
}

export class HiveRelayError extends Error {
  status: number
  gate?: THiveRelayGateError
  /**
   * Set when the relay reported a *terminal* payment state (`expired`/`failed`)
   * rather than an inconclusive one (timeout, network). Callers use it to
   * decide whether a stored L402 proof is dead and safe to discard.
   */
  paymentStatus?: TTerminalPaymentStatus

  constructor(
    message: string,
    status: number,
    gate?: THiveRelayGateError,
    paymentStatus?: TTerminalPaymentStatus
  ) {
    super(message)
    this.name = 'HiveRelayError'
    this.status = status
    this.gate = gate
    this.paymentStatus = paymentStatus
  }
}

// Late-import client to avoid a circular dependency at module load time.
// client.signer is read lazily inside the getter above.
import client from './client.service'

const instance = new HiveRelayService()
export default instance
