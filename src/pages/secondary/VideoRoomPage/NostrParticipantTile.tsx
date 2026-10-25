import { toProfile } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import {
  AudioTrack,
  ConnectionQualityIndicator,
  FocusToggle,
  ParticipantContextIfNeeded,
  ParticipantTile,
  TrackMutedIndicator,
  TrackRefContextIfNeeded,
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useMaybeLayoutContext,
  useMaybeTrackRefContext,
  useParticipantAttributes,
  useParticipantInfo,
  type TrackReferenceOrPlaceholder
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { memo, useCallback } from 'react'
import { useNostrProfiles } from './NostrProfilesContext'

/**
 * A custom ParticipantTile that shows the participant's Nostr profile avatar
 * as a placeholder image when their camera is off (muted or no video track),
 * and links the participant name to their Nostr profile.
 *
 * Profile data is resolved from (in order): the participant's LiveKit
 * attributes (which HiveRelay bakes into the JWT — `avatar_url`, `npub`,
 * `petname`, `pubkey`), the NostrProfilesContext (keyed by LiveKit identity,
 * which is the participantName), and finally the participant metadata JSON.
 */
function NostrParticipantTileImpl({
  trackRef,
  onParticipantClick,
  disableSpeakingIndicator,
  ...htmlProps
}: {
  trackRef?: TrackReferenceOrPlaceholder
  onParticipantClick?: (event: unknown) => void
  disableSpeakingIndicator?: boolean
} & React.HTMLAttributes<HTMLDivElement>) {
  const trackRefFromContext = useMaybeTrackRefContext()
  const resolvedTrackRef = trackRef ?? trackRefFromContext

  const participant = resolvedTrackRef?.participant
  const { metadata, identity } = useParticipantInfo({ participant })
  const { attributes } = useParticipantAttributes({ participant })
  const { push } = useSecondaryPage()

  // Look up the Nostr profile from context (keyed by pubkey/identity)
  const nostrProfiles = useNostrProfiles()
  const nostrMeta = nostrProfiles[identity ?? ''] ?? {}
  // Also try parsing from LiveKit metadata as fallback
  let parsedMeta: Record<string, string> = {}
  if (metadata) {
    try {
      parsedMeta = JSON.parse(metadata)
    } catch {
      // metadata is not JSON, ignore
    }
  }
  const avatarUrl =
    attributes?.avatar_url ||
    attributes?.avatar ||
    nostrMeta.avatar ||
    parsedMeta.avatar_url ||
    parsedMeta.avatar ||
    ''
  const npub = attributes?.npub || nostrMeta.npub || parsedMeta.npub || ''
  const displayName =
    nostrMeta.username ||
    attributes?.petname ||
    parsedMeta.petname ||
    parsedMeta.username ||
    participant?.name ||
    identity ||
    '?'

  const layoutContext = useMaybeLayoutContext()

  const handleSubscriptionChange = useCallback(
    (subscribed: boolean) => {
      if (
        resolvedTrackRef?.source &&
        !subscribed &&
        layoutContext?.pin.dispatch
      ) {
        // Only clear the pin if THIS track is the one currently focused.
        // Otherwise we'd clear a manual pin on a different participant's tile.
        // Use identity (string) comparison instead of reference equality —
        // participant object references are usually stable within a session,
        // but identity comparison is robust against LiveKit re-creating
        // participant objects on reconnect.
        const focusedTrack = layoutContext.pin.state?.[0]
        if (
          focusedTrack &&
          focusedTrack.participant?.identity === resolvedTrackRef.participant?.identity &&
          focusedTrack.source === resolvedTrackRef.source
        ) {
          layoutContext.pin.dispatch({ msg: 'clear_pin' })
        }
      }
    },
    [resolvedTrackRef, layoutContext]
  )

  const hasVideoTrack =
    isTrackReference(resolvedTrackRef) &&
    (resolvedTrackRef.publication?.kind === 'video' ||
      resolvedTrackRef.source === Track.Source.Camera ||
      resolvedTrackRef.source === Track.Source.ScreenShare)
  const hasAudioTrack = isTrackReference(resolvedTrackRef)

  // Subscribe to mute state so the tile re-renders when camera toggles
  useIsMuted(resolvedTrackRef as TrackReferenceOrPlaceholder)

  return (
    <ParticipantTile
      trackRef={resolvedTrackRef}
      onParticipantClick={onParticipantClick}
      disableSpeakingIndicator={disableSpeakingIndicator}
      {...htmlProps}
    >
      <TrackRefContextIfNeeded trackRef={resolvedTrackRef}>
        <ParticipantContextIfNeeded participant={participant}>
          {/* Video track (renders <video> when camera is on) */}
          {hasVideoTrack && (
            <VideoTrack
              trackRef={resolvedTrackRef}
              onSubscriptionStatusChanged={handleSubscriptionChange}
            />
          )}

          {/* Audio track (invisible, just for audio playback) */}
          {hasAudioTrack && !hasVideoTrack && (
            <AudioTrack
              trackRef={resolvedTrackRef}
              onSubscriptionStatusChanged={handleSubscriptionChange}
            />
          )}

          {/* Nostr avatar placeholder — shown when camera is off.
           * The CSS from @livekit/components-styles toggles opacity based on
           * the data-lk-video-muted attribute on the parent tile. */}
          <div className="lk-participant-placeholder">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                style={{
                  width: '50%',
                  height: 'auto',
                  maxWidth: '120px',
                  maxHeight: '120px',
                  borderRadius: '50%',
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--lk-bg4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 'bold',
                  color: 'var(--lk-fg)'
                }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Metadata bar — participant name, mute indicator, connection quality */}
          <div className="lk-participant-metadata">
            <div className="lk-participant-metadata-item">
              {resolvedTrackRef?.source === Track.Source.Camera && (
                <>
                  <TrackMutedIndicator
                    trackRef={{
                      participant: participant,
                      source: Track.Source.Microphone
                    } as TrackReferenceOrPlaceholder}
                    show="muted"
                    style={{ marginRight: '0.25rem' }}
                  />
                  {npub ? (
                    <button
                      type="button"
                      title={npub}
                      onClick={(e) => {
                        e.stopPropagation()
                        push(toProfile(npub))
                      }}
                      className="cursor-pointer hover:underline"
                      style={{ font: 'inherit', color: 'inherit' }}
                    >
                      {displayName}
                    </button>
                  ) : (
                    <span>{displayName}</span>
                  )}
                </>
              )}
              {resolvedTrackRef?.source === Track.Source.ScreenShare && (
                <>
                  <span>{displayName}</span>'s screen
                </>
              )}
            </div>
            <ConnectionQualityIndicator className="lk-participant-metadata-item" />
          </div>

          <FocusToggle trackRef={resolvedTrackRef} />
        </ParticipantContextIfNeeded>
      </TrackRefContextIfNeeded>
    </ParticipantTile>
  )
}

export const NostrParticipantTile = memo(NostrParticipantTileImpl)
