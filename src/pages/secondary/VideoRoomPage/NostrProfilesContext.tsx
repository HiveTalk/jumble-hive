import { createContext, useContext, type ReactNode } from 'react'

/**
 * A map from participant identity (LiveKit identity, which is the Nostr pubkey)
 * to Nostr profile metadata (avatar URL, username, npub).
 *
 * This is used by NostrParticipantTile to render the correct avatar without
 * relying on LiveKit's setMetadata/setAttributes RPCs (which can time out on
 * some LiveKit plans).
 */
export interface NostrProfileEntry {
  avatar?: string
  username?: string
  npub?: string
}

export type NostrProfilesMap = Record<string, NostrProfileEntry>

const NostrProfilesContext = createContext<NostrProfilesMap>({})

export function NostrProfilesProvider({
  profiles,
  children
}: {
  profiles: NostrProfilesMap
  children: ReactNode
}) {
  return (
    <NostrProfilesContext.Provider value={profiles}>
      {children}
    </NostrProfilesContext.Provider>
  )
}

export function useNostrProfiles(): NostrProfilesMap {
  return useContext(NostrProfilesContext)
}
