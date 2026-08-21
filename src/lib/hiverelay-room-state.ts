/**
 * Transient holder for a pending LiveKit join. The join flow mints a token via
 * POST /api/get-token and then navigates to the in-room secondary page. The
 * LiveKit JWT is too large to put in the route path, so it is stashed here and
 * consumed once by VideoRoomPage on mount. State is intentionally in-memory:
 * a refresh loses it and the user rejoins from the rooms page.
 */
export interface IPendingVideoRoom {
  roomName: string
  participantName: string
  token: string
  url: string
}

let pending: IPendingVideoRoom | null = null

export function setPendingVideoRoom(room: IPendingVideoRoom | null): void {
  pending = room
}

export function consumePendingVideoRoom(): IPendingVideoRoom | null {
  const r = pending
  pending = null
  return r
}

export function peekPendingVideoRoom(): IPendingVideoRoom | null {
  return pending
}
