import {
  Chat,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  RoomAudioRenderer,
  useConnectionState,
  useLayoutContext,
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

  return (
    <LayoutContextProvider>
      <NostrVideoConferenceInner roomName={roomName} token={token} />
    </LayoutContextProvider>
  )
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
  const layoutContext = useLayoutContext()

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

    if (hasActiveScreenShare && pinnedTrackRef.current === null) {
      const screenTrack = screenShareTracks[0]
      layoutContext?.pin.dispatch?.({
        msg: 'set_pin',
        trackReference: screenTrack
      })
      pinnedTrackRef.current = screenTrack
    } else if (
      pinnedTrackRef.current &&
      !screenShareTracks.some(
        (t) =>
          t.publication?.trackSid === pinnedTrackRef.current?.publication?.trackSid
      )
    ) {
      layoutContext?.pin.dispatch?.({ msg: 'clear_pin' })
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

          <div className="relative">
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
            <div
              className="pointer-events-none absolute inset-y-0 end-3 flex items-center"
              style={{ paddingBlock: '0.75rem' }}
            >
              <div className="pointer-events-auto">
                <RoomToolsMenu roomName={roomName} token={token} />
              </div>
            </div>
          </div>
        </div>

        <Chat style={{ display: widgetState.showChat ? 'grid' : 'none' }} />
      </LayoutContextProvider>

      <RoomAudioRenderer />
    </div>
  )
}
