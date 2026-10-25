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
      npub: profile.npub ?? '',
      pubkey
    }
    setProfiles((prev) => ({
      ...prev,
      [pubkey]: entry,
      [pubkey.slice(0, 8)]: entry,
      ...(profile.username ? { [profile.username]: entry } : {})
    }))
  }, [pubkey, profile])

  // Resolve remote participants' profiles when they join. HiveRelay bakes the
  // joiner's profile into the LiveKit JWT as participant attributes
  // (`avatar_url`, `npub`, `petname`, `pubkey`) — read those first since
  // `identity` is the participantName (a display name, not a pubkey). Only
  // when the token carries no avatar do we fetch the kind-0 profile from
  // Nostr relays, keyed by the advertised pubkey/npub.
  useEffect(() => {
    participants
      .filter((p) => !p.isLocal && p.identity)
      .forEach(async (p) => {
        const identity = p.identity!
        const attrs = p.attributes ?? {}
        const npub = attrs.npub ?? ''
        const remotePubkey = attrs.pubkey ?? ''
        const avatar = attrs.avatar_url || attrs.avatar || ''
        const username = attrs.petname || p.name || ''
        const existing = profiles[identity]

        if (!existing || (!existing.avatar && avatar) || (!existing.npub && npub)) {
          setProfiles((prev) => ({
            ...prev,
            [identity]: {
              ...prev[identity],
              avatar: avatar || prev[identity]?.avatar || '',
              username: username || prev[identity]?.username || '',
              npub: npub || prev[identity]?.npub || '',
              pubkey: remotePubkey || prev[identity]?.pubkey || ''
            }
          }))
        }

        // The token already told us everything we need.
        if (avatar) return
        if (existing && (existing.avatar || existing.fetchFailed)) return

        const fetchId =
          remotePubkey ||
          npub ||
          (/^[0-9a-f]{64}$|^npub1|^nprofile1/.test(identity) ? identity : '')
        if (!fetchId) return

        try {
          const fetchedProfile = await client.fetchProfile(fetchId)
          setProfiles((prev) => ({
            ...prev,
            [identity]: fetchedProfile
              ? {
                  ...prev[identity],
                  avatar: fetchedProfile.avatar || prev[identity]?.avatar || '',
                  username: fetchedProfile.username || prev[identity]?.username || '',
                  npub: fetchedProfile.npub || prev[identity]?.npub || '',
                  pubkey: fetchedProfile.pubkey || prev[identity]?.pubkey || ''
                }
              : { ...prev[identity], fetchFailed: true }
          }))
        } catch {
          setProfiles((prev) => ({
            ...prev,
            [identity]: { ...prev[identity], fetchFailed: true }
          }))
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
