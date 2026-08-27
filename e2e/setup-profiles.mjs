/**
 * One-off setup script: generates a second Nostr keypair and publishes
 * kind-0 (Metadata) profile events for both the existing and the new pubkey,
 * each with a username and avatar URL, to the default relays + HiveRelay.
 *
 * Run with: node e2e/setup-profiles.mjs
 */
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, SimplePool } from 'nostr-tools'

const RELAYS = [
  'wss://nos.lol/',
  'wss://relay.primal.net/',
  'wss://offchain.pub/',
  'wss://relay.ditto.pub/',
  'wss://l402relay.exe.xyz/'
]

// Existing key — convert hex to Uint8Array
const KEY1_HEX = 'ee67662568cba0705f88538238ea3ca68d44e8e78da9871df8d764962d85dd16'
const KEY1_SK = new Uint8Array(Buffer.from(KEY1_HEX, 'hex'))

// Generate a fresh key for the second participant
const KEY2_SK = generateSecretKey()
const KEY2_HEX = Buffer.from(KEY2_SK).toString('hex')
const KEY2_NSEC = nip19.nsecEncode(KEY2_SK)

// Derive pubkeys
const PK1 = getPublicKey(KEY1_SK)
const PK2 = getPublicKey(KEY2_SK)

console.log('=== Key Pair 1 (existing) ===')
console.log('  npub:', nip19.npubEncode(PK1))
console.log('  pubkey:', PK1)
console.log()
console.log('=== Key Pair 2 (new) ===')
console.log('  nsec:', KEY2_NSEC)
console.log('  npub:', nip19.npubEncode(PK2))
console.log('  pubkey:', PK2)
console.log()

// Profile metadata for each user
const profiles = [
  {
    sk: KEY1_SK,
    pubkey: PK1,
    name: 'HiveHost',
    display_name: 'HiveHost',
    picture: 'https://api.dicebear.com/9.x/bottts/png?seed=HiveHost&backgroundColor=1e293b',
    about: 'HiveRelay room host'
  },
  {
    sk: KEY2_SK,
    pubkey: PK2,
    name: 'BuzzGuest',
    display_name: 'BuzzGuest',
    picture: 'https://api.dicebear.com/9.x/bottts/png?seed=BuzzGuest&backgroundColor=0c4a6e',
    about: 'HiveRelay guest participant'
  }
]

// Publish kind-0 metadata events
const pool = new SimplePool()

for (const profile of profiles) {
  const content = JSON.stringify({
    name: profile.name,
    display_name: profile.display_name,
    picture: profile.picture,
    about: profile.about,
    npub: nip19.npubEncode(profile.pubkey)
  })

  const template = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content
  }

  const signedEvent = finalizeEvent(template, profile.sk)
  console.log(`Publishing profile for ${profile.name} (${profile.pubkey})...`)
  console.log(`  Avatar: ${profile.picture}`)

  const pubs = pool.publish(RELAYS, signedEvent)
  const results = await Promise.allSettled(pubs)
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const fail = results.filter((r) => r.status === 'rejected').length
  console.log(`  Published to ${ok}/${RELAYS.length} relays (${fail} failed)`)
}

pool.close()

console.log()
console.log('=== Summary ===')
console.log('User 1 nsec: nsec1aenkvftgews8qhug2wpr363u56x5f6883k5cw80c6ajfvtv9m5tqps25mg')
console.log(`User 2 nsec: ${KEY2_NSEC}`)
console.log()
console.log('Profiles published. Wait ~10s for relay propagation before running the E2E test.')

// Write the second nsec to a file so the E2E test can read it
import { writeFileSync } from 'fs'
writeFileSync('e2e/.second-nsec.txt', KEY2_NSEC)
console.log(`Second nsec written to e2e/.second-nsec.txt`)
