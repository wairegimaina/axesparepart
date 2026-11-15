import { Lock } from 'lucide-react'
import { StatusPill } from '@/components/OrderStatus'
import { dateTime } from '@/lib/format'
import type { TicketMessage, TicketStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export const TICKET_CATEGORIES = [
  ['order', 'An order'], ['delivery', 'Delivery'], ['payment', 'Payment or refund'], ['product', 'A product'],
  ['account', 'My account'], ['other', 'Something else'],
] as const

export function TicketStatusPill({ status, label }: { status: TicketStatus; label: string }) {
  const tone = { open: 'pending', answered: 'confirmed', resolved: 'completed' }[status]
  return <StatusPill status={tone} label={label} />
}

/** Conversation bubbles. `staffSide` puts staff messages on the right (admin view). */
export function Thread({ messages, staffSide = false }: { messages: TicketMessage[]; staffSide?: boolean }) {
  return (
    <ol className="grid gap-3">
      {messages.map((m) => {
        const mine = staffSide ? m.from_staff : !m.from_staff
        return (
          <li key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
              m.internal ? 'border border-dashed border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100'
                : mine ? 'bg-primary text-primary-foreground' : 'border bg-card',
            )}>
              <p className="whitespace-pre-line">{m.body}</p>
              <p className={cn('mt-1 flex items-center gap-1 text-[11px]', mine && !m.internal ? 'text-white/70' : 'text-muted-foreground')}>
                {m.internal && <><Lock className="size-3" /> Internal ·</>} {m.author} · {dateTime(m.created_at)}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
