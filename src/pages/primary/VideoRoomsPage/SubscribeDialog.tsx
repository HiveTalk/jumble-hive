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
import { Check, CheckCircle2, Loader2, RefreshCw, X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function formatDuration(days: number): string {
  const years = Math.round(days / 365)
  if (days >= 365) return `${years} Year${years === 1 ? '' : 's'}`
  return `${days} days`
}

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
      if (result.status !== 'settled') {
        throw new Error(t('Payment was not settled'))
      }
      setPhase('settled')
      toast.success(t('Payment settled!'))
      setTimeout(() => {
        onSubscribed()
        onOpenChange(false)
      }, 1500)
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
          <DialogDescription>{t('Subscribe to create and own rooms.')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-3 p-1">
            {/* Plans phase */}
            {phase === 'plans' && (
              <>
                {freeQuota > 0 && !loading && !error && (
                  <div className="border-primary/30 bg-primary/5 text-muted-foreground rounded-lg border p-3 text-xs">
                    {t('{{quota}} free rooms available without a subscription.', {
                      quota: freeQuota
                    })}
                  </div>
                )}
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="text-muted-foreground size-6 animate-spin" />
                  </div>
                )}
                {!loading && error && (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <div className="text-destructive text-sm">{error}</div>
                    <Button variant="outline" size="sm" onClick={loadPlans}>
                      <RefreshCw className="size-4" />
                      {t('Retry')}
                    </Button>
                  </div>
                )}
                {!loading &&
                  !error &&
                  plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => buyPlan(plan.id)}
                      disabled={loading}
                      className="bg-background hover:bg-accent/40 flex w-full items-center justify-between rounded-xl border p-4 text-start transition-colors disabled:opacity-50"
                    >
                      <div className="flex flex-col gap-2">
                        <div className="font-semibold">
                          {plan.display_name ?? plan.id.replace(/_/g, ' ')}{' '}
                          <span
                            className={`font-medium ${
                              Math.round(plan.days / 365) === 1 ? 'text-primary' : 'text-foreground'
                            }`}
                          >
                            {formatDuration(plan.days)}
                          </span>
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {t('{{days}} days · {{rooms}} rooms · {{sats}} sats', {
                            days: plan.days,
                            rooms: plan.room_quota,
                            sats: plan.price_sats
                          })}
                        </div>
                        {plan.features && plan.features.length > 0 && (
                          <div className="space-y-1">
                            {plan.features.map((feature) => (
                              <div
                                key={feature.id}
                                className={`flex items-start gap-1.5 text-xs ${
                                  feature.included ? 'text-foreground' : 'text-muted-foreground'
                                }`}
                              >
                                {feature.included ? (
                                  <Check className="text-primary size-3.5 shrink-0" />
                                ) : (
                                  <X className="size-3.5 shrink-0" />
                                )}
                                <span>{feature.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <Zap className="text-primary size-4" />
                    </button>
                  ))}
                {!loading && !error && plans.length === 0 && (
                  <div className="text-muted-foreground py-4 text-center text-sm">
                    {t('No plans available.')}
                  </div>
                )}
              </>
            )}

            {/* Paying phase — the wallet modal is open */}
            {phase === 'paying' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <Loader2 className="text-primary size-8 animate-spin" />
                <div className="text-muted-foreground text-sm">
                  {t('Complete the payment in your wallet...')}
                </div>
              </div>
            )}

            {/* Settled phase */}
            {phase === 'settled' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="text-primary size-10" />
                <div className="font-semibold">{t('Payment settled!')}</div>
              </div>
            )}

            {/* Error phase */}
            {phase === 'error' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="text-destructive text-sm">{error}</div>
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
