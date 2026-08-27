import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import hiverelayService from '@/services/hiverelay.service'
import { THiveRelayOwnedRoom, THiveRelayRecordingRow } from '@/types/hiverelay'
import dayjs from 'dayjs'
import { ChevronDown, Download, Loader2, Trash2, Video } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type TRecordingEntry = { roomName: string; row: THiveRelayRecordingRow }

/**
 * Lists finished recordings across all of the caller's owned rooms. Placed
 * on VideoRoomsPage right below the subscription status card. A recording is
 * considered "finished" once the relay's list endpoint reports a
 * `download_url` — still-processing/active recordings are omitted rather
 * than shown as broken links.
 */
export default function RecordingsSection({
  pubkey,
  ownedRooms
}: {
  pubkey?: string
  ownedRooms: THiveRelayOwnedRoom[]
}) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<TRecordingEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Accordion: collapsed by default so the section doesn't dominate the
  // Video Rooms page for owners who have many recordings. The count badge in
  // the header tells the user there's something to expand.
  const [expanded, setExpanded] = useState(false)
  const seqRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!pubkey || ownedRooms.length === 0) {
      setEntries([])
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    try {
      const results = await Promise.all(
        ownedRooms.map(async (room): Promise<TRecordingEntry[]> => {
          try {
            const { token } = await hiverelayService.getToken({
              roomName: room.room_name,
              participantName: pubkey.slice(0, 8),
              pubkey
            })
            const { recordings } = await hiverelayService.listRecordings(token, room.room_name)
            return recordings
              .filter((row) => !!row.download_url)
              .map((row) => ({ roomName: room.room_name, row }))
          } catch {
            // A single room's recordings failing to load (e.g. relay hiccup,
            // expired token) shouldn't blank out the rest of the list.
            return []
          }
        })
      )
      if (seq !== seqRef.current) return
      const flat = results.flat().sort((a, b) => {
        const at = a.row.stopped_at ?? a.row.started_at ?? ''
        const bt = b.row.stopped_at ?? b.row.started_at ?? ''
        return bt.localeCompare(at)
      })
      setEntries(flat)
    } catch (e) {
      if (seq === seqRef.current) toast.error(e instanceof Error ? e.message : t('Failed to load recordings'))
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [pubkey, ownedRooms, t])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleDelete = async (entry: TRecordingEntry) => {
    if (!pubkey) return
    setDeletingId(entry.row.id)
    try {
      const { token } = await hiverelayService.getToken({
        roomName: entry.roomName,
        participantName: pubkey.slice(0, 8),
        pubkey
      })
      await hiverelayService.deleteRecording(token, entry.roomName, entry.row.id)
      setEntries((prev) => prev.filter((e) => e.row.id !== entry.row.id))
      toast.success(t('Recording deleted'))
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('Failed to delete recording'))
    } finally {
      setDeletingId(null)
    }
  }

  // Nothing to show and nothing loading — don't clutter the page with an
  // empty "Recordings" section for owners who have never recorded.
  if (!pubkey || (ownedRooms.length === 0 && !loading && entries.length === 0)) return null

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center justify-between rounded-lg px-1 py-0.5 text-start transition-colors hover:bg-accent/40"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          {t('Recordings')}
          {entries.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
              {entries.length}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded &&
        (loading && entries.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed bg-background p-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-background p-4 text-center text-sm text-muted-foreground">
            {t('No recordings yet.')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div
                key={entry.row.id}
                className="flex items-center justify-between gap-2 rounded-xl border bg-background p-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Video className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate font-medium" dir="auto">
                      {entry.roomName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatRecordingMeta(entry.row)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" asChild title={t('Download')}>
                    <a href={entry.row.download_url} target="_blank" rel="noopener noreferrer">
                      <Download className="size-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    title={t('Delete recording')}
                    disabled={deletingId === entry.row.id}
                    onClick={() => handleDelete(entry)}
                  >
                    {deletingId === entry.row.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
    </section>
  )
}

function formatRecordingMeta(row: THiveRelayRecordingRow): string {
  const date = row.stopped_at ?? row.started_at
  const dateStr = date ? dayjs(date).format('MMM D, YYYY h:mm A') : ''
  const durationStr = row.duration_seconds ? formatDuration(row.duration_seconds) : ''
  return [dateStr, durationStr].filter(Boolean).join(' · ')
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
