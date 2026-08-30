import { atom } from 'jotai'

/**
 * True whenever a Video Rooms page (the room list or an active call) is the
 * page currently on top — either the "videoRooms" primary page with no
 * secondary page pushed, or a secondary page under /video-rooms/:roomName.
 *
 * Video tiles need every pixel of width, so PageManager sets this and
 * UserPreferencesProvider folds it into `enableSingleColumnLayout` (forcing
 * the single, full-width column and skipping the two-column desktop layout
 * regardless of the user's preference). Sidebar reads it directly to
 * force-collapse itself flush to the edge, without touching the user's
 * actual `sidebarCollapse` preference.
 */
export const videoRoomsActiveAtom = atom(false)
