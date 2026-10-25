import Nip05 from '@/components/Nip05'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import ZapDialog from '@/components/ZapDialog'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { getLightningAddressFromProfile } from '@/lib/lightning'
import { pubkeyToNpub, userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { ExternalLink, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Side panel with a room participant's Nostr profile: avatar, name, NIP-05,
 * about text, a nostr.at link, and a zap button when they have a lightning
 * address. `nostrId` is the participant's hex pubkey or npub — discovered
 * from the LiveKit token attributes (pubkey/npub) or a kind-0 fetch.
 */
export default function ParticipantProfileSheet({
  open,
  onOpenChange,
  nostrId,
  fallbackName
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Hex pubkey or npub. */
  nostrId: string
  fallbackName?: string
}) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const { profile, isFetching } = useFetchProfile(nostrId)
  const [zapOpen, setZapOpen] = useState(false)

  const pubkey = userIdToPubkey(nostrId)
  const npub = pubkeyToNpub(pubkey) ?? ''
  const lightningAddress = profile ? getLightningAddressFromProfile(profile) : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-4 overflow-y-auto">
        <SheetHeader className="items-center text-center">
          <SimpleUserAvatar userId={pubkey} size="large" ignorePolicy />
          <SheetTitle dir="auto">{profile?.username || fallbackName}</SheetTitle>
          <Nip05 pubkey={pubkey} />
        </SheetHeader>

        {isFetching && !profile ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : profile?.about ? (
          <p dir="auto" className="whitespace-pre-wrap text-sm text-muted-foreground">
            {profile.about}
          </p>
        ) : null}

        <a
          href={`https://nostr.at/${npub}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 break-all text-sm text-primary hover:underline"
        >
          <ExternalLink className="size-4 shrink-0" />
          {npub}
        </a>

        {lightningAddress && (
          <Button onClick={() => checkLogin(() => setZapOpen(true))}>
            <Zap className="size-4 text-yellow-400" />
            {t('Zap')}
          </Button>
        )}
        <ZapDialog open={zapOpen} setOpen={setZapOpen} pubkey={pubkey} />
      </SheetContent>
    </Sheet>
  )
}
