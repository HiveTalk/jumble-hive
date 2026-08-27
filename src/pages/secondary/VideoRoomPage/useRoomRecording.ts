import hiverelayService from '@/services/hiverelay.service'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Grace period after a successful start during which a status poll reporting recording=false is ignored (egress registration lag). */
const START_IDLE_GRACE_MS = 10_000

/** Minimum time between start/stop calls — prevents spamming the relay API. */
const ACTION_DEBOUNCE_MS = 500

function parseTimestampSeconds(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const ms = new Date(v).getTime()
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  return undefined
}

export interface TRoomRecordingActionResult {
  ok: boolean
  error?: string
}

/**
 * Recording start/stop/status-polling for a room. Mirrors HiveTalk
 * dashboard's `useRecording` hook. Polls `/api/room/recording/status` (no
 * auth — public pre-join read) every 5s (2s while finalising) so the elapsed
 * timer and idle state stay in sync even if another device started it.
 * `token` is the room's LiveKit JWT, used as Bearer auth for start/stop only.
 */
export function useRoomRecording(roomName: string | undefined, token: string | undefined) {
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const ignoreIdleUntilRef = useRef(0)
  // Timestamp of the last start/stop dispatch — used to debounce rapid calls.
  const lastActionAtRef = useRef(0)

  const pollFast = status === 'stopping'
  useEffect(() => {
    if (!roomName) return
    let cancelled = false
    const pollMs = pollFast ? 2000 : 5000
    const poll = async () => {
      try {
        const body = await hiverelayService.getRecordingStatus(roomName)
        if (cancelled) return
        if (!body.recording && Date.now() < ignoreIdleUntilRef.current) return
        setRecording(body.recording)
        setStatus(body.status)
        const polledStartedAt = parseTimestampSeconds(body.started_at)
        setStartedAt((prev) => polledStartedAt ?? (body.recording ? prev : undefined))
      } catch {
        // network error — skip this cycle
      }
    }
    void poll()
    const interval = setInterval(poll, pollMs)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [roomName, pollFast])

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [recording])

  const onStart = useCallback(async (): Promise<TRoomRecordingActionResult> => {
    if (!roomName || !token) {
      const message = 'Missing access token; please reload.'
      setError(message)
      return { ok: false, error: message }
    }
    const now = Date.now()
    if (now - lastActionAtRef.current < ACTION_DEBOUNCE_MS) {
      return { ok: false, error: 'Too many requests — please wait a moment.' }
    }
    lastActionAtRef.current = now
    setError(null)
    setPending(true)
    try {
      const body = await hiverelayService.startRecording(token, roomName)
      ignoreIdleUntilRef.current = Date.now() + START_IDLE_GRACE_MS
      setRecording(true)
      setStatus(body.status ?? 'active')
      setStartedAt(
        parseTimestampSeconds(body.started_at) ?? body.reserved_at ?? Math.floor(Date.now() / 1000)
      )
      setNow(Date.now())
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Failed to start recording.'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setPending(false)
    }
  }, [roomName, token])

  const onStop = useCallback(async (): Promise<TRoomRecordingActionResult> => {
    if (!roomName || !token) {
      const message = 'Missing access token; please reload.'
      setError(message)
      return { ok: false, error: message }
    }
    const now = Date.now()
    if (now - lastActionAtRef.current < ACTION_DEBOUNCE_MS) {
      return { ok: false, error: 'Too many requests — please wait a moment.' }
    }
    lastActionAtRef.current = now
    setError(null)
    setPending(true)
    try {
      const body = await hiverelayService.stopRecording(token, roomName)
      ignoreIdleUntilRef.current = 0
      setStatus(body.status ?? 'stopping')
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Failed to stop recording.'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setPending(false)
    }
  }, [roomName, token])

  const elapsedSeconds = recording && startedAt ? Math.max(0, Math.floor((now - startedAt * 1000) / 1000)) : 0
  const isStopping = status === 'stopping'

  return {
    recording,
    pending,
    error,
    elapsedSeconds,
    isStopping,
    onStart,
    onStop
  }
}
