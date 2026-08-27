import { Button } from '@/components/ui/button'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { consumePendingVideoRoom } from '@/lib/hiverelay-room-state'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import {
  LiveKitRoom,
  PreJoin,
  useParticipants,
  type LocalUserChoices
} from '@livekit/components-react'
import { AlertTriangle, PhoneOff } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NostrProfileSync } from './NostrProfileSync'
import { NostrProfilesProvider, type NostrProfilesMap } from './NostrProfilesContext'
import { NostrVideoConference } from './NostrVideoConference'

type TPhase = 'prejoin' | 'connecting' | 'connected' | 'error'

/**
 * Builds a map of participant identity (Nostr pubkey) → Nostr profile metadata
 * (avatar, username, npub) and provides it via NostrProfilesContext.
 *
 * The local user's profile is added immediately. Remote participants' profiles
 * are fetched from Nostr relays (kind 0 metadata events) when they join the
 * room.
 */
function NostrProfilesSync({ children }: { children: React.ReactNode }) {
  const { profile, pubkey } = useNostr()
  const participants = useParticipants()
  const [profiles, setProfiles] = useState<NostrProfilesMap>({})

  // Add the local user's profile to the map, keyed by both pubkey and
  // username (HiveRelay sets the LiveKit identity to the participantName,
  // which is the Nostr username, not the hex pubkey)
  useEffect(() => {
    if (!pubkey || !profile) return
    const entry = {
      avatar: profile.avatar ?? '',
      username: profile.username ?? '',
      npub: profile.npub ?? ''
    }
    setProfiles((prev) => ({
      ...prev,
      [pubkey]: entry,
      ...(profile.username ? { [profile.username]: entry } : {})
    }))
  }, [pubkey, profile])

  // Fetch profiles for remote participants when they join
  useEffect(() => {
    const remotePubkeys = participants
      .filter((p) => !p.isLocal && p.identity)
      .map((p) => p.identity!)
      .filter((id) => !profiles[id])

    if (remotePubkeys.length === 0) return

    // Fetch each profile from Nostr relays (kind 0 metadata)
    remotePubkeys.forEach(async (pubkey) => {
      // Mark as "fetching" to avoid duplicate fetches
      setProfiles((prev) => ({
        ...prev,
        [pubkey]: prev[pubkey] ?? {}
      }))
      try {
        const fetchedProfile = await client.fetchProfile(pubkey)
        if (fetchedProfile) {
          const entry = {
            avatar: fetchedProfile.avatar ?? '',
            username: fetchedProfile.username ?? '',
            npub: fetchedProfile.npub ?? ''
          }
          setProfiles((prev) => ({
            ...prev,
            [pubkey]: entry,
            ...(fetchedProfile.username ? { [fetchedProfile.username]: entry } : {})
          }))
        }
      } catch {
        // Profile fetch failed — leave the empty entry so we don't retry
      }
    })
  }, [participants, profiles])

  return <NostrProfilesProvider profiles={profiles}>{children}</NostrProfilesProvider>
}

const VideoRoomPage = forwardRef(
  ({ roomName, index }: { roomName?: string; index?: number }, ref) => {
    const { t } = useTranslation()
    const { pop } = useSecondaryPage()
    const { profile } = useNostr()

    const [phase, setPhase] = useState<TPhase>('prejoin')
    const [error, setError] = useState<string | null>(null)
    const [token, setToken] = useState<string | undefined>()
    const [url, setUrl] = useState<string | undefined>()
    const [choices, setChoices] = useState<LocalUserChoices | null>(null)

    const consumedRef = useRef(false)
    useEffect(() => {
      if (consumedRef.current) return
      consumedRef.current = true
      const pending = consumePendingVideoRoom()
      if (!pending) {
        setPhase('error')
        setError(t('Connection lost. Please rejoin from the Video Rooms page.'))
        return
      }
      setToken(pending.token)
      setUrl(pending.url)
    }, [t])

    const handlePreJoinSubmit = (values: LocalUserChoices) => {
      setChoices(values)
      setPhase('connecting')
    }

    const handleConnected = () => setPhase('connected')

    const handleError = (e: Error) => {
      setPhase('error')
      setError(e.message || t('Failed to connect to the room.'))
    }

    const handleDisconnected = () => {
      if (phase === 'connected') {
        pop()
      }
    }

    const leave = () => {
      pop()
    }

    const decodedRoomName = roomName ? decodeURIComponent(roomName) : undefined
    const npub = profile?.npub ?? ''

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={decodedRoomName ?? t('Video Room')}
        hideBackButton
        noScrollArea
        hideTitlebarBottomBorder
        controls={
          <Button variant="ghost" size="titlebar-icon" onClick={leave} title={t('Leave')}>
            <PhoneOff className="size-4" />
          </Button>
        }
      >
        <div
          data-lk-theme="default"
          className="lk-room-container flex min-h-0 flex-1 flex-col"
          style={{ height: '100%' }}
        >
          {/* Error state */}
          {phase === 'error' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <div className="max-w-sm text-sm text-white/80">{error}</div>
              <Button variant="outline" onClick={leave}>
                {t('Go back')}
              </Button>
            </div>
          )}

          {/* Pre-join: device selection + nostr identity */}
          {phase === 'prejoin' && url && token && (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
              <PreJoin
                defaults={{
                  username: profile?.username ?? '',
                  videoEnabled: true,
                  audioEnabled: true
                }}
                onSubmit={handlePreJoinSubmit}
                joinLabel={t('Join')}
                userLabel={t('Nostr Profile')}
              />
              {npub && (
                <a
                  href={`https://nostr.at/${npub}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 text-xs text-white/60 underline hover:text-white/90"
                >
                  {npub}
                </a>
              )}
            </div>
          )}

          {/* Connecting / Connected: LiveKit video conference */}
          {(phase === 'connecting' || phase === 'connected') && url && token && (
            <LiveKitRoom
              token={token}
              serverUrl={url}
              connect={true}
              audio={choices?.audioEnabled ?? true}
              video={choices?.videoEnabled ?? true}
              onConnected={handleConnected}
              onDisconnected={handleDisconnected}
              onError={handleError}
              style={{ height: '100%' }}
            >
              <NostrProfileSync />
              <NostrProfilesSync>
                <NostrVideoConference roomName={decodedRoomName} token={token} />
              </NostrProfilesSync>
            </LiveKitRoom>
          )}
        </div>
      </SecondaryPageLayout>
    )
  }
)

VideoRoomPage.displayName = 'VideoRoomPage'
export default VideoRoomPage
