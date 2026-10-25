import { getLightningAddressFromProfile } from '@/lib/lightning'
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
 *
 * The attribute keys match the ones the HiveTalk dashboard reads
 * (`avatar_url`, `petname`, `npub`, `lightning_address`) so dashboard users
 * see our avatar and Nostr identity even when the attributes baked into the
 * JWT at get-token time were missed. The token-time attributes are the
 * reliable path — see `buildHiveParticipantAttributes`.
 */
export function NostrProfileSync() {
  const { profile } = useNostr()
  const { localParticipant } = useLocalParticipant()

  useEffect(() => {
    if (!profile) return

    localParticipant.setName(profile.username ?? localParticipant.identity)

    const avatar = profile.avatar ?? ''
    const npub = profile.npub ?? ''
    const username = profile.username ?? ''
    const lightningAddress = getLightningAddressFromProfile(profile) ?? ''

    const metadata = JSON.stringify({
      avatar,
      avatar_url: avatar,
      npub,
      username,
      petname: username
    })
    localParticipant.setMetadata(metadata).catch(() => {})
    localParticipant
      .setAttributes({
        avatar,
        avatar_url: avatar,
        username,
        petname: username,
        npub,
        lightning_address: lightningAddress
      })
      .catch(() => {})
  }, [localParticipant, profile])

  return null
}
