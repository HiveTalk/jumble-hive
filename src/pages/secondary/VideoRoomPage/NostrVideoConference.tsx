import {
  Chat,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  RoomAudioRenderer,
  useConnectionState,
  useCreateLayoutContext,
  useTracks,
  type TrackReferenceOrPlaceholder
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useEffect, useRef, useState } from 'react'
import { NostrParticipantTile } from './NostrParticipantTile'
import { RoomToolsMenu } from './RoomToolsMenu'

/**
 * A custom VideoConference component that uses NostrParticipantTile instead of
 * the default ParticipantTile. This shows the Nostr profile avatar as a
 * placeholder when a participant's camera is off.
 *
 * This is a re-implementation of the @livekit/components-react VideoConference
 * prefab with the only difference being the custom tile component. The layout
 * (grid + focus for screen share), control bar, and chat panel are identical.
 *
 * Must be rendered inside a <LiveKitRoom> (which provides RoomContext).
 */
export function NostrVideoConference({
  roomName,
  token
}: {
  /** Exact room name used to join (for the recording/lock REST calls). */
  roomName?: string
  /** The LiveKit JWT used to join, reused as Bearer auth for owner actions. */
  token?: string
}) {
  const connectionState = useConnectionState()

  // Only render the conference once connected — the LayoutContextProvider
  // and track hooks need an active room connection.
  if (connectionState !== 'connected') {
    return (
      <div className="lk-video-conference">
        <div className="lk-video-conference-inner">
          <div className="lk-grid-layout-wrapper" />
        </div>
      </div>
    )
  }

  return <NostrVideoConferenceInner roomName={roomName} token={token} />
}

function NostrVideoConferenceInner({
  roomName,
  token
}: {
  roomName?: string
  token?: string
}) {
  const [widgetState, setWidgetState] = useState<{
    showChat: boolean
    unreadMessages: number
    showSettings?: boolean
  }>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false
  })

  const pinnedTrackRef = useRef<TrackReferenceOrPlaceholder | null>(null)
  // Single layout context — shared between the focus/layout logic and the
  // FocusToggle buttons inside participant tiles. Using useCreateLayoutContext
  // here (instead of nesting two LayoutContextProviders) ensures that pin
  // dispatches from FocusToggle reach the same state that controls the layout.
  const layoutContext = useCreateLayoutContext()

  // Camera tracks (with placeholder for muted cameras) + screen share tracks
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false }
    ],
    {
      onlySubscribed: false
    }
  )

  // Filter to screen share tracks that are actually subscribed
  const screenShareTracks = tracks.filter(
    (t) => t.publication?.source === Track.Source.ScreenShare
  )

  // The pinned/focused track (from layout context) — PinState is an array
  const focusedTrack = layoutContext?.pin.state?.[0]

  // Auto-focus screen share when it arrives
  useEffect(() => {
    const hasActiveScreenShare = screenShareTracks.some(
      (t) => t.publication?.isSubscribed
    )
    const autoPinnedTrack = pinnedTrackRef.current
    const currentFocus = layoutContext?.pin.state?.[0]

    if (hasActiveScreenShare && autoPinnedTrack === null) {
      // Only auto-pin if there's no current focus (user hasn't manually pinned)
      if (!currentFocus) {
        const screenTrack = screenShareTracks[0]
        layoutContext?.pin.dispatch?.({
          msg: 'set_pin',
          trackReference: screenTrack
        })
        pinnedTrackRef.current = screenTrack
      }
    } else if (
      autoPinnedTrack &&
      !screenShareTracks.some(
        (t) =>
          t.publication?.trackSid === autoPinnedTrack.publication?.trackSid
      )
    ) {
      // The auto-pinned screen share track is gone.
      // Only clear if the user hasn't manually focused something else.
      if (currentFocus === autoPinnedTrack) {
        layoutContext?.pin.dispatch?.({ msg: 'clear_pin' })
      }
      pinnedTrackRef.current = null
    }
  }, [
    screenShareTracks.map(
      (t) => `${t.publication?.trackSid}_${t.publication?.isSubscribed}`
    ).join(),
    layoutContext
  ])

  // Tracks to show in the grid (exclude the focused/pinned track)
  const gridTracks = focusedTrack
    ? tracks.filter((t) => t !== focusedTrack)
    : tracks

  const onWidgetChange = (state: typeof widgetState) => setWidgetState(state)

  return (
    <div
      className="lk-video-conference"
      // Override the control bar height to be more compact (icon-only mode).
      // The default is 69px which is too tall for embedded conference panels.
      // 52px fits the icon-only buttons comfortably without wasting space.
      style={{ ['--lk-control-bar-height' as string]: '52px' }}
    >
      <LayoutContextProvider
        value={layoutContext}
        onWidgetChange={onWidgetChange}
      >
        <div className="lk-video-conference-inner">
          {focusedTrack ? (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <GridLayout tracks={gridTracks}>
                  <NostrParticipantTile />
                </GridLayout>
                {focusedTrack && (
                  <FocusLayout trackRef={focusedTrack}>
                    <NostrParticipantTile trackRef={focusedTrack} />
                  </FocusLayout>
                )}
              </FocusLayoutContainer>
            </div>
          ) : (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}>
                <NostrParticipantTile />
              </GridLayout>
            </div>
          )}

          <div className="flex items-stretch">
            <div className="min-w-0 flex-1">
              <ControlBar
                variation="minimal"
                controls={{
                  microphone: true,
                  camera: true,
                  screenShare: true,
                  chat: true,
                  leave: true
                }}
              />
            </div>
            <div
              className="flex shrink-0 items-center border-t border-white/10 pe-3"
              style={{ paddingBlock: '0.75rem' }}
            >
              <RoomToolsMenu roomName={roomName} token={token} />
            </div>
          </div>
        </div>

        <Chat style={{ display: widgetState.showChat ? 'grid' : 'none' }} />
      </LayoutContextProvider>

      <RoomAudioRenderer />
    </div>
  )
}
