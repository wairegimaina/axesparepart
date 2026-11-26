import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, LifeBuoy, PackageCheck, Play, Printer, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ErrorNote, Loading, useBusy } from '@/components/common'
import { StatusPill } from '@/components/OrderStatus'
import { ReasonDialog } from '@/components/ReasonDialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMe } from '@/hooks/useAuth'
import { get, post } from '@/lib/api'
import { CONDITION_LABEL, dateTime, money } from '@/lib/format'
import type { SupplierOrderDetail } from '@/lib/types'

export default function SupplierOrderDetailPage() {
  const { number } = useParams()
  const { data: me } = useMe()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['supplier', 'order', number], queryFn: () => get<SupplierOrderDetail>(`/supplier/orders/${number}/`) })
  const [rejecting, setRejecting] = useState(false)
  const [busy, run] = useBusy()
  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorNote error={q.error ?? 'Not found'} />
  const o = q.data

  const act = (step: string, message: string, body?: object) =>
    run(async () => {
      try {
        qc.setQueryData(['supplier', 'order', number], await post<SupplierOrderDetail>(`/supplier/orders/${number}/${step}/`, body))
        qc.invalidateQueries({ queryKey: ['supplier', 'orders'] })
        qc.invalidateQueries({ queryKey: ['supplier', 'order-counts'] })
        qc.invalidateQueries({ queryKey: ['supplier', 'dashboard'] })
        toast.success(message)
      } catch (e) {
        toast.error((e as Error).message)
      }
    })

  const active = o.items.filter((i) => i.status === 'active')
  const rows = active.length ? active : o.items
  const canReject = ['incoming', 'accepted', 'processing'].includes(o.status)

  return (
    <>
      <Link to="/supplier/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"><ArrowLeft className="size-4" /> Orders</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="hidden text-sm print:block">{me?.supplier?.name}: packing slip for Axe Spare Parts</p>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{o.number}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><StatusPill status={o.status} label={o.status_display} /> Received {dateTime(o.released_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {o.status === 'incoming' && <Button disabled={busy} onClick={() => act('accept', 'Order accepted')}><Check /> Accept order</Button>}
          {o.status === 'accepted' && <Button disabled={busy} onClick={() => act('start', 'Marked as processing')}><Play /> Start processing</Button>}
          {(o.status === 'accepted' || o.status === 'processing') && (
            <Button disabled={busy} variant={o.status === 'processing' ? 'default' : 'outline'} onClick={() => act('ready', 'Ready for pickup')}><PackageCheck /> Ready for pickup</Button>
          )}
          {canReject && <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}><X /> Can't fulfil</Button>}
          <Button variant="ghost" onClick={() => window.print()}><Printer /> Packing slip</Button>
          <Button variant="ghost" render={<Link to={`/supplier/support/new?order=${o.number}`} />}><LifeBuoy /> Get help</Button>
        </div>
      </div>

      {o.status === 'incoming' && (
        <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200 print:hidden">
          Accept if you can supply every item.
        </p>
      )}
      {o.status === 'ready' && <p className="mb-6 rounded-xl bg-violet-50 p-4 text-sm text-violet-900 dark:bg-violet-500/10 dark:text-violet-200 print:hidden">Packed and waiting. Our rider will collect it and confirm here.</p>}
      {o.status === 'rejected' && <p className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">You couldn't fulfil this order: {o.rejection_reason}</p>}
      {o.status === 'cancelled' && <p className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">Cancelled. Please don't ship these items.</p>}
      {o.supplier_notes && <p className="mb-6 rounded-xl border p-4 text-sm"><span className="font-medium">Note from Axe Spare Parts:</span> {o.supplier_notes}</p>}

      <div className="overflow-x-auto surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="hidden sm:table-cell">SKU</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">You get (each)</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.id} className={i.status === 'cancelled' ? 'opacity-50' : undefined}>
                <TableCell>
                  <Link to={`/supplier/products/${i.listing}`} className="font-medium hover:underline">{i.product_name}</Link>
                  <p className="text-xs text-muted-foreground">{i.brand_name}{i.part_number && ` · ${i.part_number}`} · {CONDITION_LABEL[i.condition]}{i.on_request && ' · source on request'}</p>
                </TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{i.sku || '—'}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{i.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(i.supplier_unit_price)}
                  {Number(i.supplier_share) > 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">incl. {money(i.supplier_share)} share</p>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(i.supplier_line_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow><TableCell colSpan={4} className="text-right">You'll be paid</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(o.supplier_total)}</TableCell></TableRow>
          </TableFooter>
        </Table>
      </div>

      <section className="mt-6 surface p-5 print:hidden">
        <h2 className="mb-3 font-semibold">History</h2>
        <ol className="grid gap-3 text-sm">
          {[...o.timeline].reverse().map((e) => (
            <li key={e.id} className="border-l-2 pl-3"><p>{e.message}</p><p className="text-xs text-muted-foreground">{dateTime(e.created_at)}</p></li>
          ))}
        </ol>
      </section>

      <ReasonDialog open={rejecting} onOpenChange={setRejecting} title="Can't fulfil this order?" description="Tell us why, e.g. out of stock or damaged."
        confirmLabel="Reject order" onConfirm={async (reason) => act('reject', 'Order rejected', { reason })} />
    </>
  )
}
