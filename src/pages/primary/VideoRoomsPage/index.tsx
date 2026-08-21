import { Button } from '@/components/ui/button'
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
import { Circle, Loader2, Plus, RefreshCw, Users, Video, Zap } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
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

  const refresh = useCallback(async () => {
    if (!pubkey) return
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
      setSubscription(sub)
      setOwnedRooms(rooms)
      setLiveRooms(live)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
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
            <div className="flex items-center justify-between rounded-xl border bg-background p-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-semibold">
                  <Zap className="size-4" />
                  {entitled ? t('Subscription active') : t('No active subscription')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {subscription?.plan
                    ? t('Plan: {{plan}}', { plan: subscription.plan.replace(/_/g, ' ') })
                    : t('Subscribe to create and own rooms.')}
                </div>
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
                    ? t('Register a permanent room you own.')
                    : t('Requires an active subscription.')}
                </p>
                <Button
                  className="w-full"
                  onClick={() => setCreateOpen(true)}
                  disabled={!entitled}
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
                    <button
                      key={room.room_id}
                      onClick={() => joinOwned(room)}
                      className="flex items-center justify-between rounded-xl border bg-background p-3 text-start transition-colors hover:bg-accent/40"
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
    </PrimaryPageLayout>
  )
})

VideoRoomsPage.displayName = 'VideoRoomsPage'
export default VideoRoomsPage
