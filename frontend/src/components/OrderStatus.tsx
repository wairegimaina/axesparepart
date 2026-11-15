import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  incoming: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  on_hold: 'bg-muted text-muted-foreground',
  confirmed: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300',
  accepted: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300',
  processing: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300',
  preparing: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300',
  ready: 'bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300',
  collected: 'bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300',
  dispatched: 'bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300',
  delivered: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  completed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  partial: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  unpaid: 'bg-muted text-muted-foreground',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  cancelled: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  refunded: 'bg-muted text-muted-foreground',
}

const CUSTOMER_LABEL: Record<string, string> = {
  pending: 'Awaiting confirmation', preparing: 'Being prepared', ready: 'Ready to ship', dispatched: 'Out for delivery',
  delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled', confirmed: 'Confirmed',
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <Badge className={cn('border-0', TONE[status])}>{label ?? CUSTOMER_LABEL[status] ?? status.replace(/_/g, ' ')}</Badge>
}

export function PaymentPill({ status }: { status: string }) {
  return <StatusPill status={status} label={{ unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid', refunded: 'Refunded' }[status]} />
}

const STEPS = [
  ['pending', 'Placed'], ['preparing', 'Confirmed'], ['ready', 'Packed'], ['dispatched', 'On the way'], ['delivered', 'Delivered'],
] as const

export function CustomerProgress({ stage }: { stage: string }) {
  if (stage === 'cancelled') return null
  const index = stage === 'completed' ? STEPS.length - 1 : STEPS.findIndex(([s]) => s === stage)
  return (
    <ol className="flex items-start">
      {STEPS.map(([key, label], i) => (
        <li key={key} className="relative flex flex-1 flex-col items-center text-center">
          {i > 0 && <span className={cn('absolute top-3 right-1/2 h-0.5 w-full', i <= index ? 'bg-primary' : 'bg-border')} />}
          <span className={cn('relative z-10 flex size-6 items-center justify-center rounded-full border-2 bg-background text-xs',
            i < index || stage === 'completed' ? 'border-primary bg-primary text-primary-foreground' : i === index ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>
            {i < index || stage === 'completed' ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn('mt-1.5 text-[11px] sm:text-xs', i <= index ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
        </li>
      ))}
    </ol>
  )
}
