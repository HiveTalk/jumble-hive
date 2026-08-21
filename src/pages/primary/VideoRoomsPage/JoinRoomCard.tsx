import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setPendingVideoRoom } from '@/lib/hiverelay-room-state'
import { toVideoRoom } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import hiverelayService from '@/services/hiverelay.service'
import { Loader2, LogIn } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function JoinRoomCard() {
  const { t } = useTranslation()
  const { pubkey, profile } = useNostr()
  const { push } = useSecondaryPage()
  const [roomName, setRoomName] = useState('')
  const [loading, setLoading] = useState(false)

  const participantName = profile?.username ?? (pubkey ? pubkey.slice(0, 8) : 'anon')

  const handleJoin = async () => {
    const trimmed = roomName.trim()
    if (!trimmed || !pubkey) return
    setLoading(true)
    try {
      const { token, url } = await hiverelayService.getToken({
        roomName: trimmed,
        participantName,
        pubkey
      })
      setPendingVideoRoom({
        roomName: trimmed,
        participantName,
        token,
        url
      })
      push(toVideoRoom(trimmed))
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('Failed to join room'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2 font-semibold">
        <LogIn className="size-4" />
        {t('Join a room')}
      </div>
      <p className="text-sm text-muted-foreground">{t('Enter a room name to join')}</p>
      <div className="flex items-center gap-2">
        <Input
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleJoin()
            }
          }}
          placeholder="room77"
        />
        <Button onClick={handleJoin} disabled={loading || !roomName.trim()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : t('Join now')}
        </Button>
      </div>
    </div>
  )
}
