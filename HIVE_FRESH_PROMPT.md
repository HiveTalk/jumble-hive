# HiveRelay Video Conferencing Integration — Updated Prompt

## Overview

Integrate HiveRelay video conferencing into the Jumble Nostr client. This involves
three main user flows: subscribing to create/own rooms, creating a room, and joining
a room. The integration requires careful handling of two distinct HiveRelay
authentication mechanisms and the use of LiveKit prefab components for the UI.

## Key Details & Breadcrumbs

- **Project Name**: Jumble
- **Main Tech Stack**: React 18 + TypeScript + Vite, Tailwind CSS + Radix UI, Jotai, Nostr (nostr-tools).
- **HiveRelay Endpoint**: `https://premrelay.exe.xyz`
- **Authentication Mechanisms**:
    - **Mechanism A (Action events)**: Used for `/api/auth/login`, `/api/subscribe`, `/api/payment/status`, `/api/subscription`, `/api/register-room`, `/api/room/edit`. Involves fetching a challenge/nonce, signing a kind-27235 Nostr event with specific tags (`payload`, `action`, `nonce`, `u`, `method`), base64 encoding the event, and sending with `Authorization` and `X-Challenge` headers.
    - **Mechanism B (Body-based signed event)**: Used *only* for `/api/get-token`. The signed kind-27235 event is sent in the request body as a raw JSON string (not base64), with `pubkey` and `attributes.signed_event` fields. No `action` or `nonce` tags, no `X-Challenge` header.
- **Error Handling**: Specific handling for 402, 403, and 503 HTTP errors. On 402, an inline subscription offer should be shown.
- **LiveKit UI**: Use `@livekit/components-react` prefab components (`PreJoin`, `LiveKitRoom`, `VideoConference`). Customize `PreJoin` to use Nostr profile username and avatar.
- **Nostr Signing**: Utilize existing client infrastructure (`window.nostr`, nos2x, or nsec login) for kind-27235 event signing.

## CRITICAL: LiveKit Styling

### The #1 issue: missing CSS

The `@livekit/components-react` package provides **only the React components** — it does
NOT include any CSS. Without the styles package, all LiveKit components render as
unstyled raw HTML elements. You will see:
- Raw `<video>` elements with no border-radius, no tile layout (appears as a "green rectangle" in test screenshots because the fake media stream produces a green frame)
- No control bar styling (buttons are invisible or unstyled)
- No participant tile grid layout
- No PreJoin form styling

### Required: `@livekit/components-styles`

You MUST install and import the styles package:

```bash
npm install @livekit/components-styles
```

Then import in `src/main.tsx` (or wherever your global CSS is imported):

```typescript
import '@livekit/components-styles/themes/default'
import '@livekit/components-styles/components'
import '@livekit/components-styles/prefabs'
```

**Note**: Use the export paths WITHOUT the `.css` extension — Vite resolves them
through the package's `exports` field:
- `@livekit/components-styles/themes/default` → `dist/general/themes/default.css`
- `@livekit/components-styles/components` → `dist/general/components/index.css`
- `@livekit/components-styles/prefabs` → `dist/general/prefabs/index.css`

### Required: `data-lk-theme` attribute

The LiveKit theme CSS uses CSS variables scoped to `[data-lk-theme=default]`. You MUST
add this attribute to the container that wraps the LiveKit components:

```tsx
<div data-lk-theme="default" className="lk-room-container" style={{ height: '100%' }}>
  <LiveKitRoom ...>
    <VideoConference />
  </LiveKitRoom>
</div>
```

The `lk-room-container` class provides the base layout (`position: relative; width: 100%; height: 100%`).

### Layout pattern (matching livekit-examples/meet)

The official LiveKit Meet example uses this pattern:

```tsx
<main data-lk-theme="default" style={{ height: '100%' }}>
  {preJoin ? (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <PreJoin defaults={{ username: '' }} onSubmit={handleSubmit} />
    </div>
  ) : (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <VideoConference />
      </RoomContext.Provider>
    </div>
  )}
</main>
```

Key points:
1. The container has `data-lk-theme="default"` and `height: 100%`
2. PreJoin is centered with `display: grid; placeItems: center`
3. VideoConference is wrapped in `lk-room-container`
4. The `VideoConference` component manages its own internal layout (grid of tiles + control bar at bottom)

## CRITICAL: Layout & Control Bar Overlap

### The problem

The LiveKit `VideoConference` prefab uses a fixed-height control bar (`--lk-control-bar-height: 69px`)
positioned at the bottom of its container. The grid layout above it uses
`height: calc(100% - var(--lk-control-bar-height))` to leave room for the bar.

If the container does not have an explicit `height: 100%` (or equivalent), the control bar
will **overlap the video tiles** or get cut off entirely. This is the most common layout
issue when embedding LiveKit inside an existing client's page layout.

### Root cause: the container must fill all available space

The `lk-room-container` class sets `position: relative; width: 100%; height: 100%` — but
this only works if the **parent** element has a defined height. In many Nostr clients
(Jumble included), the secondary page content area uses flexbox with `min-h-0 flex-1` to
fill remaining space. The LiveKit container must be a direct child of that flex container
and inherit its full height.

### Required: hide or collapse side navigation while conference is active

When the video conference is active, it needs the **full viewport width and height** to
render properly. Side navigation bars, left columns, and other chrome reduce the available
space and cause the control bar to overlap or the tile grid to be cramped.

**For ANY client integration**, the video conference page should:

1. **Hide or collapse the left sidebar/navigation** while the conference is active.
   - In Jumble: the sidebar is `w-52` (208px expanded) or `w-16` (64px collapsed) via
     `useUserPreferences().sidebarCollapse`. Set `sidebarCollapse = true` on entering
     the video room, restore the previous value on leaving.
   - In other clients: hide the sidebar entirely (`display: none`) or collapse it to its
     minimum width. The goal is to give the conference the maximum available width.

2. **Use `noScrollArea` on the page layout** so the conference manages its own scrolling.
   In Jumble, `SecondaryPageLayout` accepts `noScrollArea` which renders the content in a
     `flex min-h-0 flex-1 flex-col` container instead of a `ScrollArea`. This is required
     because LiveKit's grid layout uses `height: calc(100% - var(--lk-control-bar-height))`
     which only works if the parent has a fixed height, not a scrollable overflow.

3. **Hide the page title bar** (or make it minimal). The title bar takes ~48px at the top.
   In Jumble, `SecondaryPageLayout` with `hideTitlebarBottomBorder` and a minimal `controls`
   slot (just a Leave button) reduces the chrome overhead. For a full-screen conference
   experience, consider hiding the title bar entirely and putting the Leave button in the
   LiveKit control bar instead.

4. **Ensure the container chain has explicit heights.** The full chain from the root
   layout down to the `lk-room-container` must pass `height: 100%` or use
   `flex: 1; min-height: 0`:
   ```
   PageManager (h-screen / h-(--vh))
     └─ SecondaryPageLayout (flex h-full flex-col)
        └─ noScrollArea container (flex min-h-0 flex-1 flex-col)
           └─ data-lk-theme="default" lk-room-container (height: 100%)
              └─ LiveKitRoom (height: 100%)
                 └─ NostrVideoConference
   ```

### Example: collapsing the sidebar on conference entry

```tsx
function VideoRoomPage() {
  const { sidebarCollapse, updateSidebarCollapse } = useUserPreferences()
  const prevSidebarCollapse = useRef(sidebarCollapse)

  useEffect(() => {
    // Collapse sidebar on mount to give the conference maximum width
    prevSidebarCollapse.current = sidebarCollapse
    updateSidebarCollapse(true)
    return () => {
      // Restore previous sidebar state on unmount
      updateSidebarCollapse(prevSidebarCollapse.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SecondaryPageLayout noScrollArea hideBackButton ...>
      <div data-lk-theme="default" className="lk-room-container" style={{ height: '100%' }}>
        <LiveKitRoom ...>
          <NostrVideoConference />
        </LiveKitRoom>
      </div>
    </SecondaryPageLayout>
  )
}
```

### CSS variable override (optional)

If you can't collapse the sidebar (e.g., the client doesn't support it), you can reduce
the control bar height to minimize overlap:

```css
[data-lk-theme="default"] {
  --lk-control-bar-height: 48px; /* default is 69px */
}
```

But this is a workaround — the proper fix is to give the conference full width by
collapsing or hiding side navigation.

## CRITICAL: Username and Avatar Rendering

### Username rendering

The LiveKit `VideoConference` prefab shows each participant's name in a metadata bar
at the bottom of their video tile. The name comes from the **`participantName` field
in the LiveKit JWT token** — NOT from any client-side state.

To set the username correctly:

1. **When calling `/api/get-token`**: Pass the Nostr profile username as `participantName`:
   ```typescript
   const participantName = profile?.username ?? pubkey.slice(0, 8)
   const { token, url } = await hiverelayService.getToken({
     roomName: trimmed,
     participantName,  // ← This becomes the LiveKit participant name
     pubkey
   })
   ```

2. **After connecting** (optional): Use `localParticipant.setName()` to update the
   display name if the profile loads after the token was minted:
   ```typescript
   function NostrProfileSync() {
     const { profile } = useNostr()
     const { localParticipant } = useLocalParticipant()
     useEffect(() => {
       if (!profile) return
       localParticipant.setName(profile.username ?? localParticipant.identity)
     }, [localParticipant, profile])
     return null
   }
   ```

### Avatar rendering

The LiveKit `ParticipantTile` shows a **placeholder** (avatar/icon) when a participant's
camera is muted. The placeholder is an SVG icon by default — it does NOT automatically
show a Nostr profile picture.

To show the Nostr avatar as the placeholder, you need a **custom ParticipantTile** and a
**React context** to share profile data. Relying on LiveKit's `setMetadata`/`setAttributes`
RPCs alone does NOT work reliably — they time out on some LiveKit Cloud plans (see below).

#### The working approach: NostrProfilesContext

1. **Create a React context** that maps participant identity → Nostr profile metadata:
   ```tsx
   // NostrProfilesContext.tsx
   interface NostrProfileEntry { avatar?: string; username?: string; npub?: string }
   type NostrProfilesMap = Record<string, NostrProfileEntry>
   const NostrProfilesContext = createContext<NostrProfilesMap>({})
   export const NostrProfilesProvider = ({ profiles, children }) => (
     <NostrProfilesContext.Provider value={profiles}>{children}</NostrProfilesContext.Provider>
   )
   export const useNostrProfiles = () => useContext(NostrProfilesContext)
   ```

2. **Populate the context** with the local user's profile (immediately) and remote
   participants' profiles (fetched from Nostr relays via kind 0 metadata events):
   ```tsx
   function NostrProfilesSync({ children }) {
     const { profile, pubkey } = useNostr()
     const participants = useParticipants()
     const [profiles, setProfiles] = useState<NostrProfilesMap>({})

     // Add local user's profile — keyed by BOTH pubkey AND username
     // (HiveRelay sets the LiveKit identity to the participantName/username,
     //  NOT the hex pubkey, so the lookup must work with either)
     useEffect(() => {
       if (!pubkey || !profile) return
       const entry = { avatar: profile.avatar, username: profile.username, npub: profile.npub }
       setProfiles(prev => ({ ...prev, [pubkey]: entry, [profile.username]: entry }))
     }, [pubkey, profile])

     // Fetch remote participants' profiles from Nostr relays
     useEffect(() => {
       participants.filter(p => !p.isLocal && p.identity)
         .filter(p => !profiles[p.identity])
         .forEach(async (p) => {
           const fetched = await client.fetchProfile(p.identity)
           if (fetched) setProfiles(prev => ({
             ...prev,
             [p.identity]: { avatar: fetched.avatar, username: fetched.username, npub: fetched.npub }
           }))
         })
     }, [participants, profiles])

     return <NostrProfilesProvider profiles={profiles}>{children}</NostrProfilesProvider>
   }
   ```

3. **Create a custom ParticipantTile** that reads from the context:
   ```tsx
   function NostrParticipantTile() {
     const { identity, metadata } = useParticipantInfo()
     const nostrProfiles = useNostrProfiles()
     const nostrMeta = nostrProfiles[identity ?? ''] ?? {}
     const avatarUrl = nostrMeta.avatar

     return (
       <ParticipantTile>
         <div className="lk-participant-placeholder">
           {avatarUrl ? (
             <img src={avatarUrl} alt={nostrMeta.username}
                  style={{ width: '50%', borderRadius: '50%', objectFit: 'cover' }}
                  onError={e => e.currentTarget.style.display = 'none'} />
           ) : (
             <div style={{ /* fallback letter avatar circle */ }}>
               {(nostrMeta.username ?? identity ?? '?').charAt(0).toUpperCase()}
             </div>
           )}
         </div>
       </ParticipantTile>
     )
   }
   ```

4. **Create a custom VideoConference** that uses the custom tile:
   ```tsx
   function NostrVideoConference() {
     // MUST wrap in LayoutContextProvider — the prefab does this internally
     // but a custom conference component must do it explicitly
     return (
       <LayoutContextProvider>
         <GridLayout tracks={tracks}>
           <NostrParticipantTile />
         </GridLayout>
         <ControlBar controls={{ microphone: true, camera: true, screenShare: true, chat: true, leave: true }} />
       </LayoutContextProvider>
     )
   }
   ```

5. **Wire it up** in the page:
   ```tsx
   <LiveKitRoom token={token} serverUrl={url} connect>
     <NostrProfileSync />      {/* sets name/metadata via LiveKit RPCs (best-effort) */}
     <NostrProfilesSync>       {/* provides NostrProfilesContext */}
       <NostrVideoConference />
     </NostrProfilesSync>
   </LiveKitRoom>
   ```

### CRITICAL: HiveRelay sets LiveKit identity to the username, NOT the pubkey

When HiveRelay mints a LiveKit JWT token, it sets the participant **identity** to the
`participantName` field from the `/api/get-token` request — which is the Nostr **username**
(e.g., "HiveHost"), NOT the hex pubkey.

This means:
- `useParticipantInfo().identity` returns the username (e.g., "HiveHost")
- `useParticipantInfo().name` also returns the username
- The `NostrProfilesMap` MUST be keyed by username as well as pubkey, or the avatar lookup
  will fail

### Known issue: `setMetadata` / `setAttributes` timeout

On some LiveKit Cloud plans, `localParticipant.setMetadata()` and
`localParticipant.setAttributes()` can time out with
`"Request to update local metadata timed out"`. This is a server-side limitation,
not a client bug. The calls are best-effort — wrap them in `.catch(() => {})`.

The **username** set via the token's `participantName` field always works (it's
baked into the JWT at token-mint time, not a runtime RPC). So usernames render
correctly even when `setMetadata`/`setAttributes` fail.

**This is why the NostrProfilesContext approach is required** — it does not depend on
LiveKit RPCs to propagate avatar URLs. The context is populated from the local user's
Nostr profile (immediately) and from Nostr relay fetches for remote participants (async).

## Starting Point

The new integration will be built "from scratch" on a new branch named `hive-fresh`
off the `master` branch.

## Identified UI Components & Utilities

- `AccountManager` (`components/AccountManager/index.tsx`) and `PrivateKeyLogin` (`components/AccountManager/PrivateKeyLogin.tsx`) for private key login.
- `LoginDialog` (`components/LoginDialog/index.tsx`) for managing login.
- `HIVERELAY_API_BASE`, `HIVERELAY_RELAY_URL`, `HIVERELAY_ACTION_KIND`, `HIVERELAY_ROOM_ANNOUNCEMENT_KIND` constants are needed.
- `VideoRoomsButton` (`components/Sidebar/VideoRoomsButton.tsx`) for navigation.
- `PrimaryPageLayout` and `SecondaryPageLayout` in `src/layouts` are available for page structuring.
- `useNostr` provider for `profile`, `pubkey`, and `signer` access. `TProfile` defines `username`, `avatar`, and `npub` fields.
- UI components like `Dialog`, `Button`, `Input`, `Label`, `ScrollArea` (`components/ui/`).
- Icon libraries: `@phosphor-icons/react` and `lucide-react`.
- `useSecondaryPage` push/pop pattern for navigation.

## Dev Environment

- Node v20.20.2 (as specified in `.nvmrc`)
- The `node_modules/.bin/tsc` symlink can break; fix with:
  `rm -f node_modules/.bin/tsc && ln -s ../typescript/bin/tsc node_modules/.bin/tsc`

## Packages Required

```
@livekit/components-react
@livekit/components-styles  ← CRITICAL: without this, no CSS styling
livekit-client
```
