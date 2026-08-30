import hiverelayService from '@/services/hiverelay.service'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { useCallback, useEffect, useRef, useState } from 'react'

const LOCK_TOPIC = 'lk.roomlock'

/** Minimum time between toggle calls — prevents spamming the relay API. */
const TOGGLE_DEBOUNCE_MS = 500

/** Parses the `lk.roomlock` data-channel broadcast hiverelay sends on lock/unlock. */
function parseLockMessage(payload: Uint8Array, topic?: string): boolean | null {
  if (topic !== LOCK_TOPIC) return null
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload)) as {
      event?: string
      locked?: unknown
    }
    if (msg?.event === 'lock_changed' && typeof msg.locked === 'boolean') {
      return msg.locked
    }
    return null
  } catch {
    return null
  }
}

/**
 * Tracks a room's lock state and exposes a toggle. Hydrates from
 * `GET /api/room-info` on mount (so the state survives a rejoin), then stays
 * live via the `lk.roomlock` data-channel broadcast hiverelay sends to every
 * participant whenever the owner/moderator flips the lock.
 */
export function useRoomLock(roomName: string | undefined, token: string | undefined) {
  const room = useRoomContext()
  const [locked, setLocked] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set as soon as the caller performs their own toggle, so a slow mount-time
  // hydration GET that resolves afterwards doesn't clobber a fresher local
  // (optimistic or server-confirmed) state with a stale snapshot.
  //
  // Reset to false at the end of each hydration cycle so that future
  // hydrations (on roomName change or remount) are not permanently blocked
  // by a toggle that happened during a previous hydration window.
  const hasLocalActionRef = useRef(false)

  // Timestamp of the last toggle dispatch — used to debounce rapid calls.
  const lastToggleAtRef = useRef(0)

  useEffect(() => {
    if (!roomName) return
    let cancelled = false
    hiverelayService
      .getRoomInfo(roomName)
      .then((info) => {
        if (!cancelled && info && !hasLocalActionRef.current) setLocked(info.locked === true)
      })
      .catch(() => {
        // Fail silently — the data-channel broadcast is the live source of truth.
      })
      .finally(() => {
        // Reset so a future hydration (roomName change, remount) is not
        // permanently blocked by a toggle made during this window.
        if (!cancelled) hasLocalActionRef.current = false
      })
    return () => {
      cancelled = true
    }
  }, [roomName])

  useEffect(() => {
    if (!room) return
    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      const next = parseLockMessage(payload, topic)
      if (next !== null) setLocked(next)
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room])

  // Optimistic toggle with revert-on-failure, same shape as the recording hook.
  // Debounced to prevent spamming the relay API with rapid back-to-back calls.
  const toggle = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!roomName || !token) {
      const message = 'Missing access token; please reload.'
      setError(message)
      return { ok: false, error: message }
    }
    const now = Date.now()
    if (now - lastToggleAtRef.current < TOGGLE_DEBOUNCE_MS) {
      return { ok: false, error: 'Too many requests — please wait a moment.' }
    }
    lastToggleAtRef.current = now
    const next = !locked
    hasLocalActionRef.current = true
    setError(null)
    setPending(true)
    setLocked(next)
    try {
      await hiverelayService.setRoomLock(token, roomName, next)
      return { ok: true }
    } catch (e) {
      setLocked(!next)
      const message = e instanceof Error && e.message ? e.message : 'Failed to update room lock.'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setPending(false)
    }
  }, [roomName, token, locked])

  return { locked, pending, error, toggle }
}
