import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { setPendingVideoRoom } from '@/lib/hiverelay-room-state'
import { toVideoRoom } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import hiverelayService, { HiveRelayError } from '@/services/hiverelay.service'
import { useNostr } from '@/providers/NostrProvider'
import { TPageRef } from '@/types'
import {
  THiveRelayOwnedRoom,
  THiveRelayRoomSummary,
  THiveRelaySubscription
} from '@/types/hiverelay'
import { CheckCircle2, Circle, Loader2, Plus, RefreshCw, Trash2, Users, Video, Zap } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import CreateRoomDialog from './CreateRoomDialog'
import JoinRoomCard from './JoinRoomCard'
import SubscribeDialog from './SubscribeDialog'

const VideoRoomsPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { pubkey, profile, checkLogin } = useNostr()
  const { push } = useSecondaryPage()

  const [subscription, setSubscription] = useState<THiveRelaySubscription | null>(null)
  const [ownedRooms, setOwnedRooms] = useState<THiveRelayOwnedRoom[]>([])
  const [liveRooms, setLiveRooms] = useState<THiveRelayRoomSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [subscribeOpen, setSubscribeOpen] = useState(false)
  const [deletingRoom, setDeletingRoom] = useState<THiveRelayOwnedRoom | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const refreshSeqRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!pubkey) return
    const seq = ++refreshSeqRef.current
    setLoading(true)
    try {
      const [sub, rooms, live] = await Promise.all([
        hiverelayService.getSubscription().catch((e: unknown) => {
          // 401 just means not identified yet; treat as no subscription.
          if (e instanceof HiveRelayError && e.status === 401) return null
          throw e
        }),
        hiverelayService.getRoomsByPubkey(pubkey).catch(() => [] as THiveRelayOwnedRoom[]),
        hiverelayService.listRooms().catch(() => [] as THiveRelayRoomSummary[])
      ])
      // Discard stale results from a previous account (switched away mid-fetch).
      if (seq !== refreshSeqRef.current) return
      setSubscription(sub)
      setOwnedRooms(rooms)
      setLiveRooms(live)
    } catch (e) {
      if (seq !== refreshSeqRef.current) return
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === refreshSeqRef.current) setLoading(false)
    }
  }, [pubkey])

  // Clear stale state immediately when the active account changes, before the
  // async refresh lands. Without this, switching from a subscribed account to
  // an unsubscribed one briefly (or permanently, if the fetch errors) shows the
  // previous account's subscription as active for the new account.
  useEffect(() => {
    setSubscription(null)
    setOwnedRooms([])
    setLiveRooms([])
    if (pubkey) refresh()
  }, [pubkey, refresh])

  const joinOwned = async (room: THiveRelayOwnedRoom) => {
    if (!pubkey) return
    try {
      const participantName = profile?.username ?? pubkey.slice(0, 8)
      const { token, url } = await hiverelayService.getToken({
        roomName: room.room_name,
        participantName,
        pubkey
      })
      setPendingVideoRoom({ roomName: room.room_name, participantName, token, url })
      push(toVideoRoom(room.room_name))
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('Failed to join room'))
    }
  }

  const joinLive = async (room: THiveRelayRoomSummary) => {
    if (!pubkey) return
    try {
      const participantName = profile?.username ?? pubkey.slice(0, 8)
      const { token, url } = await hiverelayService.getToken({
        roomName: room.name,
        participantName,
        pubkey
      })
      setPendingVideoRoom({ roomName: room.name, participantName, token, url })
      push(toVideoRoom(room.name))
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('Failed to join room'))
    }
  }

  const entitled = subscription?.entitled ?? false
  const roomQuota = subscription?.room_quota ?? 0
  const roomsInUse = subscription?.rooms_in_use ?? ownedRooms.length
  const atRoomQuota = roomsInUse >= roomQuota && roomQuota > 0

  const confirmDelete = async () => {
    if (!deletingRoom) return
    setDeleteLoading(true)
    try {
      const result = await hiverelayService.deleteRoom(deletingRoom.room_name)
      if (result.deleted) {
        toast.success(t('Room "{{room}}" deleted', { room: deletingRoom.room_name }))
        setOwnedRooms((prev) => prev.filter((r) => r.room_id !== deletingRoom.room_id))
      } else {
        toast.error(t('Failed to delete room'))
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('Failed to delete room'))
    } finally {
      setDeleteLoading(false)
      setDeletingRoom(null)
    }
  }

  return (
    <PrimaryPageLayout
      pageName="videoRooms"
      icon={<Video />}
      title={t('Video Rooms')}
      displayScrollToTopButton
      ref={ref}
      controls={
        <Button
          variant="ghost"
          size="titlebar-icon"
          onClick={() => refresh()}
          disabled={loading}
          title={t('Refresh')}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {!pubkey ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-background p-8 text-center">
            <Video className="size-8 text-muted-foreground" />
            <div className="font-medium">{t('Video Rooms')}</div>
            <p className="text-sm text-muted-foreground">
              {t('Login with your Nostr key to create and join video rooms.')}
            </p>
            <Button onClick={() => checkLogin()}>{t('Subscribe')}</Button>
          </div>
        ) : (
          <>
            {/* Subscription status */}
            <div
              className={
                entitled
                  ? 'flex items-center justify-between rounded-xl border border-emerald-500/50 bg-gradient-to-r from-emerald-500/20 to-green-500/10 p-4 ring-1 ring-emerald-500/30'
                  : 'flex items-center justify-between rounded-xl border bg-background p-4'
              }
            >
              <div className="flex flex-col gap-1">
                <div
                  className={
                    entitled
                      ? 'flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'flex items-center gap-2 font-semibold'
                  }
                >
                  {entitled ? (
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  ) : (
                    <Zap className="size-4" />
                  )}
                  {entitled ? t('Subscription active') : t('No active subscription')}
                </div>
                <div className={entitled ? 'text-xs text-emerald-600/70 dark:text-emerald-400/70' : 'text-xs text-muted-foreground'}>
                  {subscription?.plan
                    ? t('Plan: {{plan}}', { plan: subscription.plan.replace(/_/g, ' ') })
                    : t('Subscribe to create and own rooms.')}
                </div>
                {entitled && roomQuota > 0 && (
                  <div className={entitled ? 'text-xs text-emerald-600/70 dark:text-emerald-400/70' : 'text-xs text-muted-foreground'}>
                    {t('Rooms: {{used}} / {{quota}}', { used: roomsInUse, quota: roomQuota })}
                  </div>
                )}
              </div>
              {!entitled && (
                <Button size="sm" onClick={() => setSubscribeOpen(true)}>
                  {t('Subscribe')}
                </Button>
              )}
            </div>

            {/* Create + Join */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-xl border bg-background p-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Plus className="size-4" />
                  {t('Create a room')}
                </div>
                <p className="text-sm text-muted-foreground">
                  {entitled
                    ? atRoomQuota
                      ? t('Room quota reached ({{used}}/{{quota}}). Delete a room to create a new one.', { used: roomsInUse, quota: roomQuota })
                      : t('Register a permanent room you own.')
                    : t('Requires an active subscription.')}
                </p>
                <Button
                  className="w-full"
                  onClick={() => setCreateOpen(true)}
                  disabled={!entitled || atRoomQuota}
                >
                  <Plus className="size-4" />
                  {t('Create room')}
                </Button>
              </div>
              <JoinRoomCard />
            </div>

            {/* Owned rooms */}
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{t('Your rooms')}</h2>
              {ownedRooms.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-background p-4 text-center text-sm text-muted-foreground">
                  {t('You have not created any rooms yet.')}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {ownedRooms.map((room) => (
                    <div
                      key={room.room_id}
                      className="flex items-center justify-between rounded-xl border bg-background p-3 transition-colors hover:bg-accent/40"
                    >
                      <button
                        onClick={() => joinOwned(room)}
                        className="flex min-w-0 flex-1 items-center justify-between text-start"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium" dir="auto">
                            {room.room_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {room.is_private ? t('Private') : t('Public')}
                            {room.audience_mode ? ` · ${t('Audience mode')}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-primary">
                          <Video className="size-4" />
                          {t('Join')}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeletingRoom(room)}
                        title={t('Delete room')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Live rooms */}
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{t('Live now')}</h2>
              {liveRooms.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-background p-4 text-center text-sm text-muted-foreground">
                  {t('No live rooms right now.')}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {liveRooms.map((room) => (
                    <button
                      key={room.sid}
                      onClick={() => joinLive(room)}
                      className="flex items-center justify-between rounded-xl border bg-background p-3 text-start transition-colors hover:bg-accent/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium" dir="auto">
                          {room.name}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Circle className="size-2 fill-destructive text-destructive" />
                          <Users className="size-3" />
                          {room.numParticipants}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-primary">
                        <Video className="size-4" />
                        {t('Join')}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refresh()} />
      <SubscribeDialog
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        onSubscribed={() => refresh()}
      />

      {/* Delete room confirmation */}
      <AlertDialog open={!!deletingRoom} onOpenChange={(open) => !open && setDeletingRoom(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete room')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to delete "{{room}}"? This will remove the LiveKit room, access policies, and Nostr announcement. This action cannot be undone.',
                { room: deletingRoom?.room_name }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? <Loader2 className="size-4 animate-spin" /> : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PrimaryPageLayout>
  )
})

VideoRoomsPage.displayName = 'VideoRoomsPage'
export default VideoRoomsPage
