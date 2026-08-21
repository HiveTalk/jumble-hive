/**
 * HiveRelay API types.
 *
 * HiveRelay is a Nostr relay (NIP-42/NIP-53) that fronts LiveKit, owns the room
 * registry, and mints LiveKit access tokens. These types mirror the REST API
 * at https://premrelay.exe.xyz (see /openapi.yaml).
 */

// ---- Auth / challenge -------------------------------------------------

export interface THiveRelayChallenge {
  challenge: string // JWT sent back as X-Challenge
  nonce: string // hex, single-use, echoed in the action event's `nonce` tag
  expires_at: number
  domain: string
}

// ---- Plans / subscription --------------------------------------------

export type THiveRelayPlanId = string

export interface THiveRelayPlan {
  id: THiveRelayPlanId
  room_quota: number
  days: number
  price_sats: number
}

export interface THiveRelayPlansResponse {
  free_quota: number
  plans: THiveRelayPlan[]
}

export interface THiveRelaySubscription {
  pubkey: string
  plan: string
  status: string
  room_quota: number
  paid_until: string | null
  entitled: boolean
  can_record?: boolean
  [key: string]: unknown
}

// ---- Payments ---------------------------------------------------------

export interface THiveRelayInvoice {
  intent_id: string
  plan: string
  amount_sats: number
  bolt11: string
  payment_hash: string
  expires_at: number
  status: 'pending' | 'settled' | 'expired' | 'failed'
}

export interface THiveRelayPaymentStatusResponse {
  intent_id: string
  status: 'pending' | 'settled' | 'expired' | 'failed'
  plan: string
  subscription?: THiveRelaySubscription
}

// ---- Rooms ------------------------------------------------------------

export interface THiveRelayRegisteredRoom {
  room_id: string
  room_name: string
  owner_pubkey: string
  created_via: string
  is_private: boolean
  broadcast_pending: boolean
  audience_mode?: boolean
}

export interface THiveRelayOwnedRoom {
  room_id: string
  room_name: string
  is_private: boolean
  audience_mode?: boolean
}

export interface THiveRelayRoomInfo {
  room_id: string
  room_name: string
  owner_pubkey: string
  is_private: boolean
  aliases?: string[]
}

export interface THiveRelayRoomSummary {
  sid: string
  name: string
  numParticipants: number
}

// ---- get-token --------------------------------------------------------

export interface THiveRelayGetTokenRequest {
  roomName: string
  participantName: string
  pubkey: string
  attributes?: Record<string, unknown>
}

export interface THiveRelayGetTokenResponse {
  token: string
  url: string
}

// ---- Error / gate -----------------------------------------------------

export type THiveRelayGateReason =
  | 'subscription_required'
  | 'subscription_expired'
  | 'free_quota_exceeded'
  | 'quota_exceeded'
  | 'room_not_registered'
  | 'client_attestation_failed'
  | 'could_not_verify_room'
  | 'could_not_verify_subscription'
  | string

export interface THiveRelayGateError {
  error: string
  reason?: THiveRelayGateReason
  plans?: THiveRelayPlan[]
  subscribe_api?: string
  subscribe_url?: string
}
