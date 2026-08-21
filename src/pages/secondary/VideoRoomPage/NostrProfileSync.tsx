import { useNostr } from '@/providers/NostrProvider'
import { useLocalParticipant } from '@livekit/components-react'
import { useEffect } from 'react'

/**
 * Syncs the local participant's LiveKit identity with the Nostr profile.
 *
 * Sets the display name via `setName` and stores the avatar URL in metadata
 * via `setMetadata` so other participants can see it (if their LiveKit plan
 * supports it). Both calls are best-effort — some LiveKit plans don't support
 * these RPCs and will time out.
 */
export function NostrProfileSync() {
  const { profile } = useNostr()
  const { localParticipant } = useLocalParticipant()

  useEffect(() => {
    if (!profile) return

    localParticipant.setName(profile.username ?? localParticipant.identity)

    const metadata = JSON.stringify({
      avatar: profile.avatar ?? '',
      npub: profile.npub ?? '',
      username: profile.username ?? ''
    })
    localParticipant.setMetadata(metadata).catch(() => {})
    localParticipant
      .setAttributes({
        avatar: profile.avatar ?? '',
        username: profile.username ?? '',
        npub: profile.npub ?? ''
      })
      .catch(() => {})
  }, [localParticipant, profile])

  return null
}
