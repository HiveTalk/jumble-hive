import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import hiverelayService from '@/services/hiverelay.service'
import { THiveRelayPlan } from '@/types/hiverelay'
import { CheckCircle2, Loader2, RefreshCw, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type TPhase = 'plans' | 'paying' | 'settled' | 'error'

export default function SubscribeDialog({
  open,
  onOpenChange,
  onSubscribed
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubscribed: () => void
}) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<TPhase>('plans')
  const [plans, setPlans] = useState<THiveRelayPlan[]>([])
  const [freeQuota, setFreeQuota] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPhase('plans')
    setPlans([])
    setFreeQuota(0)
    setLoading(false)
    setError(null)
  }

  const loadPlans = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await hiverelayService.getPlans()
      setPlans(res.plans)
      setFreeQuota(res.free_quota)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Load plans when the dialog opens (useEffect, not onOpenChange,
  // because onOpenChange may not fire when the open prop changes externally)
  useEffect(() => {
    if (open) {
      reset()
      loadPlans()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open)
  }

  const buyPlan = async (planId: string) => {
    setLoading(true)
    setError(null)
    setPhase('paying')
    try {
      const result = await hiverelayService.subscribe(planId)
      if (result.status === 'settled') {
        setPhase('settled')
        toast.success(t('Payment settled!'))
        setTimeout(() => {
          onSubscribed()
          onOpenChange(false)
        }, 1500)
      } else {
        throw new Error('Payment was not settled')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] w-[440px] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-5" />
            {t('Subscribe')}
          </DialogTitle>
          <DialogDescription>
            {t('Subscribe to create and own rooms.')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-3 p-1">
            {/* Plans phase */}
            {phase === 'plans' && (
              <>
                {freeQuota > 0 && !loading && !error && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                    {t('{{quota}} free rooms available without a subscription.', { quota: freeQuota })}
                  </div>
                )}
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!loading && error && (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <div className="text-sm text-destructive">{error}</div>
                    <Button variant="outline" size="sm" onClick={loadPlans}>
                      <RefreshCw className="size-4" />
                      {t('Retry')}
                    </Button>
                  </div>
                )}
                {!loading && !error &&
                  plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => buyPlan(plan.id)}
                      disabled={loading}
                      className="flex w-full items-center justify-between rounded-xl border bg-background p-4 text-start transition-colors hover:bg-accent/40 disabled:opacity-50"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="font-semibold">{plan.id.replace(/_/g, ' ')}</div>
                        <div className="text-xs text-muted-foreground">
                          {t('{{days}} days · {{rooms}} rooms · {{sats}} sats', {
                            days: plan.days,
                            rooms: plan.room_quota,
                            sats: plan.price_sats
                          })}
                        </div>
                      </div>
                      <Zap className="size-4 text-primary" />
                    </button>
                  ))}
                {!loading && !error && plans.length === 0 && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    {t('No plans available.')}
                  </div>
                )}
              </>
            )}

            {/* Paying phase — the wallet modal is open */}
            {phase === 'paying' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">
                  {t('Complete the payment in your wallet...')}
                </div>
              </div>
            )}

            {/* Settled phase */}
            {phase === 'settled' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="size-10 text-primary" />
                <div className="font-semibold">{t('Payment settled!')}</div>
              </div>
            )}

            {/* Error phase */}
            {phase === 'error' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="text-sm text-destructive">{error}</div>
                <Button variant="outline" onClick={reset}>
                  {t('Go back')}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
