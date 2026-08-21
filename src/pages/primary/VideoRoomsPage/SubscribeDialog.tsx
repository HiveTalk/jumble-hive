import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import hiverelayService from '@/services/hiverelay.service'
import {
  THiveRelayInvoice,
  THiveRelayPaymentStatusResponse,
  THiveRelayPlan
} from '@/types/hiverelay'
import { CheckCircle2, Loader2, Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type TPhase = 'plans' | 'invoice' | 'polling' | 'settled' | 'error'

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
  const [invoice, setInvoice] = useState<THiveRelayInvoice | null>(null)
  const [pollStatus, setPollStatus] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setPhase('plans')
    setPlans([])
    setInvoice(null)
    setPollStatus('')
    setLoading(false)
    setError(null)
  }

  const loadPlans = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await hiverelayService.getPlans()
      setPlans(res.plans)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      reset()
      loadPlans()
    }
    onOpenChange(open)
  }

  const buyPlan = async (planId: string) => {
    setLoading(true)
    setError(null)
    try {
      const inv = await hiverelayService.subscribe(planId)
      setInvoice(inv)
      setPhase('invoice')
      // Start polling immediately
      pollPayment(inv.intent_id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('error')
    } finally {
      setLoading(false)
    }
  }

  const pollPayment = async (intentId: string) => {
    setPhase('polling')
    try {
      const result = await hiverelayService.pollPaymentUntilSettled(intentId, {
        intervalMs: 3000,
        timeoutMs: 10 * 60 * 1000,
        onPoll: (s: THiveRelayPaymentStatusResponse) => {
          setPollStatus(s.status)
        }
      })
      if (result.status === 'settled') {
        setPhase('settled')
        toast.success(t('Payment settled!'))
        setTimeout(() => {
          onSubscribed()
          onOpenChange(false)
        }, 1500)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('error')
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
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!loading &&
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
                {!loading && plans.length === 0 && !error && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    {t('No plans available.')}
                  </div>
                )}
              </>
            )}

            {/* Invoice phase — show BOLT11 for user to pay */}
            {phase === 'invoice' && invoice && (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {t('Scan or paste this invoice in your Lightning wallet')}
                </div>
                <Input
                  readOnly
                  value={invoice.bolt11}
                  className="text-xs"
                  onClick={(e) => e.currentTarget.select()}
                />
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  <span>{t('Waiting for payment...')}</span>
                </div>
              </div>
            )}

            {/* Polling phase */}
            {phase === 'polling' && invoice && (
              <div className="space-y-3">
                <Input
                  readOnly
                  value={invoice.bolt11}
                  className="text-xs"
                  onClick={(e) => e.currentTarget.select()}
                />
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  <span>
                    {t('Waiting for payment...')} ({pollStatus})
                  </span>
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
