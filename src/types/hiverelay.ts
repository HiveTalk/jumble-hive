/**
 * HiveRelay API types.
 *
 * HiveRelay is a Nostr relay (NIP-42/NIP-53) that fronts LiveKit, owns the room
 * registry, and mints LiveKit access tokens. These types mirror the REST API
 * at the HiveRelay REST API (see /openapi.yaml on the relay host).
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

export interface THiveRelayPlanFeature {
  id: string
  label: string
  included: boolean
  available?: boolean
  value?: number
  unit?: string
}

export interface THiveRelayPlan {
  id: THiveRelayPlanId
  display_name?: string
  room_quota: number
  days: number
  price_sats: number
  features: THiveRelayPlanFeature[]
}

export interface THiveRelayPlansResponse {
  free_quota: number
  free_features?: THiveRelayPlanFeature[]
  plans: THiveRelayPlan[]
}

export interface THiveRelaySubscription {
  pubkey: string
  plan: string
  status: 'none' | 'active' | 'expired' | 'cancelled' | string
  room_quota: number
  rooms_in_use?: number
  free_quota?: number
  grace_days?: number
  in_grace?: boolean
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
  locked?: boolean
  lobby_enabled?: boolean
}

export interface THiveRelayRoomSummary {
  sid: string
  name: string
  numParticipants: number
}

export interface THiveRelayRoomDeleteResponse {
  deleted: boolean
  room_name: string
  livekit_deleted: boolean
  events_removed: number
}

// ---- Room lock ----------------------------------------------------------

export interface THiveRelayLockResponse {
  room_name: string
  locked: boolean
  lobby_enabled?: boolean
}

// ---- Recording ----------------------------------------------------------

export interface THiveRelayRecordingStartResponse {
  recording_id: string
  room_name: string
  status: string
  egress_id: string
  started_at?: string
  object_key?: string
  expires_at?: string
  reserved_at?: number
}

export interface THiveRelayRecordingStopResponse {
  recording_id: string
  room_name: string
  status: string
  egress_id: string
  stop_requested_at?: string | number
}

export interface THiveRelayRecordingStatus {
  room_name: string
  recording: boolean
  status?: string
  started_at?: number | string
  reserved_at?: number
  egress_id?: string
}

export interface THiveRelayRecordingRow {
  id: string
  room_name: string
  status: string
  egress_id?: string
  object_key?: string
  file_size_bytes?: number
  duration_seconds?: number
  started_at?: string
  stopped_at?: string
  expires_at?: string
  error?: string
  download_url?: string
  download_expires_at?: string
}

export interface THiveRelayRecordingListResponse {
  room_name: string
  recordings: THiveRelayRecordingRow[]
}

export interface THiveRelayRecordingDownloadResponse {
  recording_id: string
  room_name: string
  status: string
  download_url: string
  download_expires_at?: string
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
