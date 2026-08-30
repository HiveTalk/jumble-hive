import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useLocalParticipant } from '@livekit/components-react'
import { ChevronUp, Circle, Info, Loader2, Lock, LockOpen, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useRoomLock } from './useRoomLock'
import { useRoomRecording } from './useRoomRecording'

/**
 * Owner-only "^" side menu next to the control bar: Lock Room and
 * Record/Stop Recording. Hidden entirely for non-owners since HiveRelay
 * gates both actions to the room owner (the LiveKit JWT's `owner` attribute
 * is set server-side when the caller's pubkey matches the registered owner).
 */
export function RoomToolsMenu({ roomName, token }: { roomName?: string; token?: string }) {
  const { t } = useTranslation()
  const { localParticipant } = useLocalParticipant()
  const isOwner = localParticipant?.attributes?.owner === 'true'
  const [open, setOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const { locked, pending: lockPending, toggle: toggleLock } = useRoomLock(roomName, token)
  const {
    recording,
    pending: recPending,
    elapsedSeconds,
    isStopping,
    onStart,
    onStop
  } = useRoomRecording(roomName, token)

  useEffect(() => {
    if (!open) return
    const onOutsideClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutsideClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  if (!isOwner) return null

  // Close immediately on click (instant feedback, matches a standard menu)
  // instead of waiting for the network round trip — awaiting first would
  // leave the panel open long enough to invite a second, conflicting click.
  const handleInfo = () => {
    setOpen(false)
    setInfoOpen(true)
  }

  const handleToggleLock = async () => {
    setOpen(false)
    const { ok, error } = await toggleLock()
    if (!ok) toast.error(error || t('Failed to update room lock'))
  }

  const handleToggleRecording = async () => {
    setOpen(false)
    const wasRecording = recording
    const { ok, error } = wasRecording ? await onStop() : await onStart()
    if (!ok) {
      toast.error(
        error || (wasRecording ? t('Could not stop recording') : t('Could not start recording'))
      )
    }
  }

  const recordLabel = recording
    ? isStopping
      ? t('Finalizing…')
      : t('Stop ({{time}})', { time: formatElapsed(elapsedSeconds) })
    : t('Record')

  return (
    <div ref={wrapperRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label={t('Room tools')}
          className="absolute bottom-full end-0 mb-2 flex w-52 flex-col gap-1 rounded-lg border border-white/10 bg-neutral-900/95 p-1.5 shadow-lg backdrop-blur"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleInfo}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm text-white/90 transition-colors hover:bg-white/10"
          >
            <Info className="size-4 shrink-0 text-primary" />
            {t('Info')}
          </button>
          <div className="my-0.5 h-px bg-white/10" />
          <button
            type="button"
            role="menuitem"
            disabled={lockPending}
            onClick={handleToggleLock}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm text-white/90 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {lockPending ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : locked ? (
              <Lock className="size-4 shrink-0 text-amber-400" />
            ) : (
              <LockOpen className="size-4 shrink-0" />
            )}
            {locked ? t('Unlock room') : t('Lock room')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={recPending || isStopping}
            onClick={handleToggleRecording}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm text-white/90 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {recPending ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : recording ? (
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
                <Square className="size-3.5 fill-red-500 text-red-500" />
              </span>
            ) : (
              <Circle className="size-4 shrink-0" />
            )}
            <span className="truncate">{recordLabel}</span>
          </button>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('Room tools')}
        title={t('Room tools')}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center gap-2 rounded-[var(--lk-border-radius)] bg-primary px-4 py-2.5 text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <ChevronUp className={cn('size-5 transition-transform', open && 'rotate-180')} />
      </button>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="size-5 text-primary" />
              {t('About this integration')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {t(
                'This jumble integration is demo white label version of hivetalk.org, for other moderation controls and features, please visit API docs, llms.txt at https://relay.hivetalk.org/'
              )}{' '}
              <a
                href="https://relay.hivetalk.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline hover:text-primary-hover"
              >
                relay.hivetalk.org
              </a>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setInfoOpen(false)}>{t('Close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
