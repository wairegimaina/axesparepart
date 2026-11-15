import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, CheckCircle2, LifeBuoy, Phone, Printer, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ErrorNote, Loading } from '@/components/common'
import { CustomerProgress, PaymentPill, StatusPill } from '@/components/OrderStatus'
import { ReasonDialog } from '@/components/ReasonDialog'
import { Receipt } from '@/components/Receipt'
import { Button } from '@/components/ui/button'
import { get, post } from '@/lib/api'
import { CONDITION_LABEL, date, dateTime, money } from '@/lib/format'
import type { CustomerOrder } from '@/lib/types'

export default function OrderDetail() {
  const { number } = useParams()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['customer-order', number], queryFn: () => get<CustomerOrder>(`/account/orders/${number}/`) })
  const [cancelling, setCancelling] = useState(false)
  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorNote error={q.error ?? 'Order not found'} />
  const o = q.data

  return (
    <>
    <Receipt order={o} />
    <div className="print:hidden">
      <Link to="/account/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Orders</Link>
      {params.get('placed') && (
        <div className="mb-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 className="size-5 shrink-0" />
          <div>
            <p className="font-medium">Thank you! Order {o.number} is placed.</p>
            <p className="mt-0.5">We'll call {o.phone} shortly to confirm the parts, delivery fee and delivery time.</p>
          </div>
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{o.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill status={o.stage} /> <PaymentPill status={o.payment_status} /> Placed {dateTime(o.created_at)}
          </p>
        </div>
        <div className="flex gap-2">
          {o.status !== 'cancelled' && o.verified_at && (
            <Button variant="outline" onClick={() => window.print()}><Printer /> {o.payment_status === 'paid' ? 'Receipt' : 'Invoice'}</Button>
          )}
          <Button variant="outline" render={<Link to={`/account/support/new?order=${o.number}`} />}><LifeBuoy /> Get help</Button>
          {o.can_cancel && <Button variant="outline" onClick={() => setCancelling(true)}>Cancel order</Button>}
        </div>
      </div>

      {o.status === 'cancelled' ? (
        <p className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">This order was cancelled. {o.cancel_reason}</p>
      ) : (
        <div className="mb-6 surface p-5"><CustomerProgress stage={o.stage} /></div>
      )}

      {o.status === 'dispatched' && o.courier && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <span className="flex items-center gap-2 font-medium"><Truck className="size-4 text-primary" /> {o.courier}</span>
          {o.courier_phone && <a href={`tel:${o.courier_phone}`} className="flex items-center gap-1.5 text-primary hover:underline"><Phone className="size-3.5" /> {o.courier_phone}</a>}
          {o.tracking_number && <span>Tracking <span className="font-mono">{o.tracking_number}</span></span>}
          {o.expected_delivery_date && <span className="flex items-center gap-1.5"><CalendarClock className="size-4" /> Expected {date(o.expected_delivery_date)}</span>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="grid content-start gap-6">
          <section className="surface">
            <ul className="divide-y">
              {o.items.map((i) => (
                <li key={i.id} className={`flex gap-4 p-4 ${i.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <Link to={`/products/${i.product_slug}`} className="font-medium hover:underline">{i.product_name}</Link>
                    <p className="text-xs text-muted-foreground">{i.brand_name}{i.part_number && ` · ${i.part_number}`} · {CONDITION_LABEL[i.condition]}{i.warranty && ` · ${i.warranty} warranty`}</p>
                    {i.status === 'cancelled' && <p className="mt-1 text-xs text-destructive">Removed from order</p>}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium tabular-nums">{money(i.line_total)}</p>
                    <p className="text-xs text-muted-foreground">{i.quantity} × {money(i.unit_price)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="grid gap-1.5 border-t p-4 text-sm">
              {Number(o.delivery_fee) > 0 && <>
                <div className="flex justify-between"><dt className="text-muted-foreground">Parts</dt><dd className="tabular-nums">{money(o.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd className="tabular-nums">{money(o.delivery_fee)}</dd></div>
              </>}
              <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(o.total)}</dd></div>
              {Number(o.amount_paid) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{money(o.amount_paid)}</dd></div>}
              {o.refunds.map((r, n) => (
                <div key={n} className="flex justify-between"><dt className="text-muted-foreground">Refunded {date(r.refunded_at)}</dt><dd className="tabular-nums">−{money(r.amount)}</dd></div>
              ))}
            </dl>
          </section>

          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">Updates</h2>
            <ol className="grid gap-3 text-sm">
              {[...o.timeline].reverse().map((e) => (
                <li key={e.id} className="border-l-2 pl-3">
                  <p>{e.message}</p>
                  <p className="text-xs text-muted-foreground">{dateTime(e.created_at)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Delivery</h2>
            <p>{o.recipient_name}</p>
            <p className="flex items-center gap-1.5 text-muted-foreground"><Phone className="size-3.5" /> {o.phone}</p>
            <p className="text-muted-foreground">{o.street_address}, {o.town}, {o.county}</p>
            {o.delivery_notes && <p className="mt-1 text-muted-foreground">{o.delivery_notes}</p>}
          </section>
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Payment</h2>
            <p>{o.payment_status_display}</p>
            {Number(o.balance_due) > 0 && o.status !== 'cancelled' && <p className="text-muted-foreground">Due: {money(o.balance_due)}</p>}
          </section>
        </aside>
      </div>

      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this order?"
        description="Tell us why (optional). This can't be undone."
        confirmLabel="Cancel order"
        required={false}
        onConfirm={async (reason) => {
          try {
            qc.setQueryData(['customer-order', number], await post<CustomerOrder>(`/account/orders/${number}/cancel/`, { reason }))
            qc.invalidateQueries({ queryKey: ['customer-orders'] })
            toast.success('Order cancelled')
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
    </div>
    </>
  )
}
