import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, Check, Eye, EyeOff, PackageCheck, PackageX, Phone, PhoneMissed, Truck, Undo2, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ErrorNote, Field, Loading, NativeSelect, VerifiedBadge, useBusy } from '@/components/common'
import { PaymentPill, StatusPill } from '@/components/OrderStatus'
import { ReasonDialog } from '@/components/ReasonDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/hooks/useAuth'
import { get, patch, post } from '@/lib/api'
import { CONDITION_LABEL, date, dateTime, money } from '@/lib/format'
import type { AdminOrder, AdminOrderItem, PaymentMethod, RefundMethod } from '@/lib/types'

interface Alternative {
  listing_id: number
  supplier: string
  supplier_verified: boolean
  condition: 'new' | 'refurbished' | 'used'
  availability: string
  quantity: number
  supplier_price?: string
  customer_price: string
  enough_stock: boolean
}

type DialogState =
  | null
  | { kind: 'verify' | 'dispatch' | 'payment' | 'cancel' | 'refund' | 'failed' }
  | { kind: 'reassign' | 'remove'; item: AdminOrderItem }

function ReassignDialog({ item, onClose, onDone }: { item: AdminOrderItem; onClose: () => void; onDone: () => void }) {
  const alts = useQuery({ queryKey: ['admin', 'alternatives', item.id], queryFn: () => get<Alternative[]>(`/admin/order-items/${item.id}/alternatives/`) })
  const [busy, run] = useBusy()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Source from another supplier</DialogTitle>
          <DialogDescription>{item.quantity} × {item.product_name}. The customer keeps their price of {money(item.unit_price)} each.</DialogDescription>
        </DialogHeader>
        {alts.isLoading ? <Loading /> : alts.data?.length ? (
          <ul className="divide-y rounded-lg border text-sm">
            {alts.data.map((a) => {
              const margin = a.supplier_price === undefined ? null : Number(item.unit_price) - Number(a.supplier_price)
              return (
                <li key={a.listing_id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{a.supplier}{a.supplier_verified && <VerifiedBadge />}</p>
                    <p className="text-xs text-muted-foreground">
                      {CONDITION_LABEL[a.condition]} · {a.availability === 'on_request' ? 'on request' : `${a.quantity} in stock`}
                      {margin !== null && <> · supplier {money(a.supplier_price)}<span className={margin < 0 ? ' text-destructive' : ''}> · margin {money(margin)}/unit</span></>}
                    </p>
                  </div>
                  <Button size="sm" disabled={busy || !a.enough_stock}
                    onClick={() => run(async () => {
                      try { await post(`/admin/order-items/${item.id}/reassign/`, { listing_id: a.listing_id }); toast.success(`Sent to ${a.supplier}`); onDone() } catch (e) { toast.error((e as Error).message) }
                    })}>
                    {a.enough_stock ? 'Use' : 'Not enough'}
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No other supplier lists this part. Remove it from the order instead.</p>}
      </DialogContent>
    </Dialog>
  )
}

export default function AdminOrderDetail() {
  const { number } = useParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'order', number], queryFn: () => get<AdminOrder>(`/admin/orders/${number}/`) })
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, run] = useBusy()
  const [fee, setFee] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const { data: me } = useMe()
  const fullAdmin = me?.admin_scope !== 'orders'
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [courierPhone, setCourierPhone] = useState('')
  const [expected, setExpected] = useState('')
  const [refund, setRefund] = useState({ amount: '', method: 'bank_transfer' as RefundMethod, reference: '', reason: '' })
  const [pay, setPay] = useState({ amount: '', method: 'cash_on_delivery' as PaymentMethod, reference: '' })
  const [note, setNote] = useState('')
  const [noteForCustomer, setNoteForCustomer] = useState(false)
  const [adminNotes, setAdminNotes] = useState('')
  useEffect(() => {
    if (q.data) {
      setFee(Number(q.data.delivery_fee) ? q.data.delivery_fee : q.data.suggested_delivery_fee)
      setAdminNotes(q.data.admin_notes)
      setPay((p) => ({ ...p, amount: q.data!.balance_due, method: q.data!.payment_method }))
      setRefund((r) => ({ ...r, amount: q.data!.refund_due }))
      if (q.data.courier) setCourier(q.data.courier)
      if (q.data.courier_phone) setCourierPhone(q.data.courier_phone)
    }
  }, [q.data])

  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorNote error={q.error ?? 'Not found'} />
  const o = q.data

  const refresh = (data?: AdminOrder) => {
    if (data) qc.setQueryData(['admin', 'order', number], data)
    else qc.invalidateQueries({ queryKey: ['admin', 'order', number] })
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] })
    qc.invalidateQueries({ queryKey: ['admin', 'order-counts'] })
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
  }
  const call = (path: string, body: object, message: string) =>
    run(async () => {
      try {
        refresh(await post<AdminOrder>(`/admin/orders/${number}/${path}/`, body))
        setDialog(null)
        toast.success(message)
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  const collect = (soId: number) =>
    run(async () => {
      try { await post(`/admin/supplier-orders/${soId}/collected/`); refresh(); toast.success('Marked collected') } catch (e) { toast.error((e as Error).message) }
    })

  const activeSOs = o.supplier_orders.filter((so) => !['rejected', 'cancelled'].includes(so.status))
  const allCollected = activeSOs.length > 0 && activeSOs.every((so) => so.status === 'collected')
  const unresolved = o.supplier_orders.some((so) => so.status === 'rejected' && so.items.some((i) => i.status === 'active'))
  const margin = o.supplier_cost === undefined ? null : Number(o.subtotal) - Number(o.supplier_cost)
  const checklist = [
    { key: 'person', label: `Spoke to ${o.recipient_name}` },
    { key: 'parts', label: 'Parts and quantities are right' },
    { key: 'address', label: `Delivery address is right: ${o.town}, ${o.county}` },
    { key: 'total', label: `Customer agreed to the total: ${money(Number(o.subtotal) + Number(fee || 0))}` },
    { key: 'payment', label: 'Agreed with the customer how and when they will pay' },
  ]
  const allChecked = checklist.every((c) => checked[c.key])
  const netPaid = Number(o.amount_paid) - Number(o.amount_refunded)

  return (
    <>
      <Link to="/admin/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Orders</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{o.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /> Placed {dateTime(o.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.status === 'pending' && <Button onClick={() => { setChecked({}); setDialog({ kind: 'verify' }) }}><Check /> Confirm order</Button>}
          {o.status === 'pending' && <Button variant="outline" disabled={busy} onClick={() => call('no-answer', {}, "Missed call saved. The customer was told we'll call again")}><PhoneMissed /> No answer</Button>}
          {o.status === 'confirmed' && <Button disabled={!allCollected || unresolved} title={allCollected ? undefined : 'Collect from every supplier first'} onClick={() => setDialog({ kind: 'dispatch' })}><Truck /> Dispatch</Button>}
          {o.status === 'dispatched' && <Button disabled={busy} onClick={() => call('deliver', {}, 'Marked delivered')}><PackageCheck /> Mark delivered</Button>}
          {o.status === 'dispatched' && <Button variant="outline" onClick={() => setDialog({ kind: 'failed' })}><PackageX /> Delivery failed</Button>}
          {o.status === 'delivered' && <Button disabled={busy || o.payment_status !== 'paid'} title={o.payment_status === 'paid' ? undefined : 'Record payment first'} onClick={() => call('complete', {}, 'Order completed')}><Check /> Complete</Button>}
          {!['cancelled', 'completed'].includes(o.status) && Number(o.balance_due) > 0 && <Button variant="outline" onClick={() => setDialog({ kind: 'payment' })}><Wallet /> Record payment</Button>}
          {fullAdmin && netPaid > 0 && <Button variant={Number(o.refund_due) > 0 ? 'default' : 'ghost'} onClick={() => setDialog({ kind: 'refund' })}><Undo2 /> Refund</Button>}
          {['pending', 'confirmed'].includes(o.status) && <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>Cancel order</Button>}
        </div>
      </div>

      {o.status === 'pending' && (
        <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Call {o.recipient_name} on <a className="font-medium underline" href={`tel:${o.phone}`}>{o.phone}</a> to confirm the parts, the delivery fee and the address. Suppliers won't see the order until you confirm it.
          {o.call_attempts > 0 && (
            <span className="mt-2 flex items-center gap-1.5 font-medium"><PhoneMissed className="size-4" /> {o.call_attempts} missed call{o.call_attempts === 1 ? '' : 's'}, last tried {dateTime(o.last_call_at)}.</span>
          )}
        </p>
      )}
      {unresolved && <p className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">A supplier rejected some items. Reassign or remove them below.</p>}
      {Number(o.refund_due) > 0 && <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Refund due: <span className="font-semibold">{money(o.refund_due)}</span>. Send it to the customer, then record it here.</p>}
      {o.status === 'cancelled' && <p className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">Cancelled {dateTime(o.cancelled_at)}. {o.cancel_reason}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-4">
          {o.supplier_orders.map((so) => (
            <section key={so.id} className="surface">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {fullAdmin ? <Link to={`/admin/suppliers/${so.supplier.id}`} className="hover:underline">{so.supplier.name}</Link> : so.supplier.name}
                    {so.supplier.is_verified && <VerifiedBadge />}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{so.number}</span> · {[so.supplier_address, so.supplier.town].filter(Boolean).join(', ')}
                    {so.supplier_phone && <> · <a href={`tel:${so.supplier_phone}`} className="underline">{so.supplier_phone}</a></>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={so.status} label={so.status_display} />
                  {['ready', 'accepted', 'processing'].includes(so.status) && o.status === 'confirmed' && (
                    <Button size="sm" variant={so.status === 'ready' ? 'default' : 'outline'} disabled={busy} onClick={() => collect(so.id)}>Collected</Button>
                  )}
                </div>
              </header>
              {so.status === 'rejected' && <p className="border-b bg-red-50/60 px-4 py-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">Rejected: {so.rejection_reason}</p>}
              <ul className="divide-y">
                {so.items.map((i) => (
                  <li key={i.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${i.status === 'cancelled' ? 'opacity-50' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{i.quantity} × {i.product_name}</p>
                      <p className="text-xs text-muted-foreground">{i.brand_name}{i.part_number && ` · ${i.part_number}`} · {CONDITION_LABEL[i.condition]}{i.on_request && ' · on request'}{i.status === 'cancelled' && ' · removed'}</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-sm tabular-nums">{money(i.line_total)}</p>
                      {i.supplier_line_total !== undefined && <p className="text-muted-foreground tabular-nums">cost {money(i.supplier_line_total)}</p>}
                    </div>
                    {i.status === 'active' && so.status === 'rejected' && o.status === 'confirmed' && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => setDialog({ kind: 'reassign', item: i })}>Reassign</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'remove', item: i })}>Remove</Button>
                      </div>
                    )}
                    {i.status === 'active' && o.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'remove', item: i })}>Remove</Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">Timeline</h2>
            <ol className="grid gap-3 text-sm">
              {[...o.events].reverse().map((e) => (
                <li key={e.id} className="border-l-2 pl-3">
                  <p>{e.message}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {dateTime(e.created_at)}{e.actor && ` · ${e.actor}`}{e.supplier_order && ` · ${e.supplier_order}`}
                    {e.visible_to_customer ? <span className="inline-flex items-center gap-0.5"><Eye className="size-3" /> customer</span> : <span className="inline-flex items-center gap-0.5"><EyeOff className="size-3" /> internal</span>}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-4 grid gap-2 border-t pt-4">
              <Textarea rows={2} placeholder="Add a note to the timeline" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Timeline note" />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={noteForCustomer} onCheckedChange={(v) => setNoteForCustomer(!!v)} /> Customer can see it</label>
                <Button size="sm" disabled={!note.trim() || busy} onClick={() => { call('note', { message: note, visible_to_customer: noteForCustomer }, 'Note added'); setNote('') }}>Add note</Button>
              </div>
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Customer</h2>
            <p className="font-medium">{o.customer.full_name}</p>
            <p className="text-muted-foreground">{o.customer.email}</p>
            <Link to={`/admin/customers/${o.customer.id}`} className="text-xs underline">{o.customer.order_count} order{o.customer.order_count === 1 ? '' : 's'} in total</Link>
            {o.customer_notes && <p className="mt-2 rounded-lg bg-muted p-2">“{o.customer_notes}”</p>}
          </section>
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Deliver to</h2>
            <p>{o.recipient_name}</p>
            <a href={`tel:${o.phone}`} className="flex items-center gap-1.5 underline"><Phone className="size-3.5" /> {o.phone}</a>
            <p className="text-muted-foreground">{o.street_address}, {o.town}, {o.county}</p>
            {o.delivery_notes && <p className="text-muted-foreground">{o.delivery_notes}</p>}
            {o.courier && (
              <div className="mt-2 grid gap-0.5 border-t pt-2">
                <p className="flex items-center gap-1.5"><Truck className="size-3.5" /> {o.courier}{o.tracking_number && ` · ${o.tracking_number}`}</p>
                {o.courier_phone && <a href={`tel:${o.courier_phone}`} className="flex items-center gap-1.5 underline"><Phone className="size-3.5" /> {o.courier_phone}</a>}
                {o.status === 'dispatched' && o.expected_delivery_date && <p className="flex items-center gap-1.5"><CalendarClock className="size-3.5" /> Expected {date(o.expected_delivery_date)}</p>}
              </div>
            )}
            {o.delivery_attempts > 0 && <p className="mt-1 text-xs text-destructive">{o.delivery_attempts} failed attempt{o.delivery_attempts === 1 ? '' : 's'}</p>}
          </section>
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Money</h2>
            <dl className="grid gap-1">
              <div className="flex justify-between"><dt className="text-muted-foreground">Parts</dt><dd className="tabular-nums">{money(o.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Delivery</dt><dd className="tabular-nums">{money(o.delivery_fee)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(o.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{money(o.amount_paid)}</dd></div>
              {Number(o.amount_refunded) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Refunded</dt><dd className="tabular-nums">−{money(o.amount_refunded)}</dd></div>}
              {margin !== null && <>
                <div className="mt-2 flex justify-between border-t pt-2"><dt className="text-muted-foreground">Supplier cost</dt><dd className="tabular-nums">{money(o.supplier_cost)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Parts margin</dt><dd className={`tabular-nums ${margin < 0 ? 'text-destructive' : ''}`}>{money(margin)}</dd></div>
              </>}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Payment method: {({ to_be_agreed: 'To be agreed', cash_on_delivery: 'Cash on delivery', bank_transfer: 'Bank transfer' } as Record<string, string>)[o.payment_method] ?? o.payment_method}</p>
            {o.payments.length > 0 && (
              <ul className="mt-2 grid gap-1 border-t pt-2 text-xs">
                {o.payments.map((p) => <li key={p.id} className="flex justify-between gap-2"><span className="min-w-0 break-words">{dateTime(p.received_at)} · {p.method_display}{p.reference && ` · ${p.reference}`}</span><span className="shrink-0 tabular-nums">{money(p.amount)}</span></li>)}
              </ul>
            )}
            {o.refunds.length > 0 && (
              <ul className="mt-2 grid gap-1 border-t pt-2 text-xs">
                {o.refunds.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="min-w-0 break-words">{dateTime(r.refunded_at)} · refund · {r.method_display}{r.reference && ` · ${r.reference}`}</span><span className="shrink-0 tabular-nums">−{money(r.amount)}</span></li>)}
              </ul>
            )}
          </section>
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Internal notes</h2>
            <Textarea rows={3} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} aria-label="Internal notes" />
            {adminNotes !== o.admin_notes && (
              <Button size="sm" className="mt-2" onClick={() => run(async () => { refresh(await patch<AdminOrder>(`/admin/orders/${number}/`, { admin_notes: adminNotes })); toast.success('Saved') })}>Save</Button>
            )}
          </section>
        </aside>
      </div>

      <Dialog open={dialog?.kind === 'verify'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm order</DialogTitle>
            <DialogDescription>Tick each point as you go through it on the call.</DialogDescription>
          </DialogHeader>
          <Field label="Delivery fee (KES)" htmlFor="v-fee" hint={`Parts ${money(o.subtotal)}, so the new total is ${money(Number(o.subtotal) + Number(fee || 0))}`}>
            <Input id="v-fee" type="number" min="0" value={fee} onChange={(e) => setFee(e.target.value)} />
          </Field>
          <div className="grid gap-2.5 rounded-xl border bg-muted/40 p-3">
            {checklist.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" checked={!!checked[c.key]} onCheckedChange={(v) => setChecked((s) => ({ ...s, [c.key]: !!v }))} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <Field label="Call notes (internal)" htmlFor="v-note"><Textarea id="v-note" rows={2} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} /></Field>
          <DialogFooter><Button disabled={busy || !allChecked} title={allChecked ? undefined : 'Tick every point first'} onClick={() => call('verify', { delivery_fee: fee || '0', note: verifyNote }, 'Order confirmed, suppliers notified')}>Confirm and notify suppliers</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === 'dispatch'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dispatch to customer</DialogTitle></DialogHeader>
          <Field label="Courier or rider" htmlFor="d-courier"><Input id="d-courier" placeholder="e.g. G4S, Sendy, own rider (name)" value={courier} onChange={(e) => setCourier(e.target.value)} /></Field>
          <Field label="Courier or rider phone" htmlFor="d-phone"><Input id="d-phone" type="tel" placeholder="+254…" value={courierPhone} onChange={(e) => setCourierPhone(e.target.value)} /></Field>
          <Field label="Tracking number (optional)" htmlFor="d-track"><Input id="d-track" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
          <Field label="Expected delivery" htmlFor="d-date" hint="Leave empty to use the county's delivery time"><Input id="d-date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          <DialogFooter><Button disabled={busy || !courier.trim()} onClick={() => call('dispatch', { courier, tracking_number: tracking, courier_phone: courierPhone, expected_delivery_date: expected || null }, 'Dispatched, customer notified')}>Dispatch</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === 'payment'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>{money(o.balance_due)} due.</DialogDescription></DialogHeader>
          <Field label="Amount received (KES)" htmlFor="p-amt"><Input id="p-amt" type="number" min="0" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
          <Field label="Method" htmlFor="p-method">
            <NativeSelect id="p-method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
              <option value="cash_on_delivery">Cash on delivery</option>
              <option value="bank_transfer">Bank transfer</option>
            </NativeSelect>
          </Field>
          <Field label="Reference" htmlFor="p-ref" ><Input id="p-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          <DialogFooter><Button disabled={busy || !Number(pay.amount)} onClick={() => call('payment', pay, 'Payment recorded')}>Record payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === 'refund'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record refund</DialogTitle><DialogDescription>Received {money(netPaid)}{Number(o.refund_due) > 0 && `, refund due ${money(o.refund_due)}`}.</DialogDescription></DialogHeader>
          <Field label="Amount refunded (KES)" htmlFor="r-amt"><Input id="r-amt" type="number" min="0" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></Field>
          <Field label="Method" htmlFor="r-method">
            <NativeSelect id="r-method" value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value as RefundMethod })}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </NativeSelect>
          </Field>
          <Field label="Reference" htmlFor="r-ref"><Input id="r-ref" value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} /></Field>
          <Field label="Reason (customer sees it)" htmlFor="r-reason"><Input id="r-reason" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></Field>
          <DialogFooter><Button disabled={busy || !Number(refund.amount) || !refund.reason.trim()} onClick={() => call('refund', refund, 'Refund recorded')}>Record refund</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog open={dialog?.kind === 'failed'} onOpenChange={(v) => !v && setDialog(null)} title="Delivery failed" description="The order goes back to ready to dispatch. The customer sees your reason." confirmLabel="Record failed delivery"
        onConfirm={async (reason) => call('delivery-failed', { reason }, 'Recorded. Ready to dispatch again')} />
      <ReasonDialog open={dialog?.kind === 'cancel'} onOpenChange={(v) => !v && setDialog(null)} title="Cancel order" description="The customer will see your reason." confirmLabel="Cancel order"
        onConfirm={async (reason) => call('cancel', { reason }, 'Order cancelled')} />
      <ReasonDialog open={dialog?.kind === 'remove'} onOpenChange={(v) => !v && setDialog(null)} title="Remove item" description="The total is recalculated and the customer is told why." confirmLabel="Remove item"
        onConfirm={async (reason) => {
          if (dialog?.kind !== 'remove') return
          try { await post(`/admin/order-items/${dialog.item.id}/remove/`, { reason }); refresh(); toast.success('Item removed') } catch (e) { toast.error((e as Error).message) }
        }} />
      {dialog?.kind === 'reassign' && <ReassignDialog item={dialog.item} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh() }} />}
    </>
  )
}
