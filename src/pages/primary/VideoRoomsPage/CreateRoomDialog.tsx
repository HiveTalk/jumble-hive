import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import hiverelayService, { HiveRelayError } from '@/services/hiverelay.service'
import { CheckCircle2, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

// 3-64 runes, letters/digits/-/_ from any script, no leading/trailing - or _
const ROOM_NAME_RE = /^[A-Za-z0-9_\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff][A-Za-z0-9_\-\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff]{1,62}[A-Za-z0-9\u00C0-\u024F\u0400-\u04FF\u4e00-\u9fff]$/

export default function CreateRoomDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [roomName, setRoomName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const reset = () => {
    setRoomName('')
    setLoading(false)
    setError(null)
    setCreated(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  const validate = (name: string): string | null => {
    if (name.length < 3 || name.length > 64) return t('Room name must be 3-64 characters')
    if (!ROOM_NAME_RE.test(name)) {
      return t('Room name can only contain letters, digits, hyphens and underscores')
    }
    return null
  }

  const handleCreate = async () => {
    const validationError = validate(roomName)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError(null)
    try {
      await hiverelayService.registerRoom(roomName)
      setCreated(true)
      toast.success(t('Room created!'))
      setTimeout(() => {
        onCreated()
        onOpenChange(false)
      }, 1200)
    } catch (e) {
      if (e instanceof HiveRelayError) {
        setError(e.gate?.error ?? e.message)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5" />
            {t('Create room')}
          </DialogTitle>
          <DialogDescription>{t('Register a permanent room you own.')}</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-primary" />
            <div className="font-semibold">{t('Room created!')}</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="room-name-input">{t('Room name')}</Label>
              <Input
                id="room-name-input"
                value={roomName}
                onChange={(e) => {
                  setRoomName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreate()
                  }
                }}
                placeholder="my-room"
                className={error ? 'border-destructive' : ''}
              />
              {error && <div className="text-xs text-destructive">{error}</div>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                {t('Go back')}
              </Button>
              <Button onClick={handleCreate} disabled={loading || !roomName}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('Creating room...')}
                  </>
                ) : (
                  t('Create room')
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
