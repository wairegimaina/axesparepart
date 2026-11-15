import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager } from '@/components/common'
import { PaymentPill } from '@/components/OrderStatus'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get, qs } from '@/lib/api'
import { date, dateTime, money } from '@/lib/format'
import type { AdminOrderSummary, Paginated } from '@/lib/types'

const TABS = [['ready_to_dispatch', 'Ready to dispatch'], ['out_for_delivery', 'Out for delivery']] as const

export default function AdminDeliveries() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const view = params.get('view') ?? 'ready_to_dispatch'
  const page = Number(params.get('page') ?? 1)
  const counts = useQuery({ queryKey: ['admin', 'order-counts'], queryFn: () => get<Record<string, number>>('/admin/orders/counts/') })
  const q = { view, page }
  const list = useQuery({ queryKey: ['admin', 'orders', q], queryFn: () => get<Paginated<AdminOrderSummary>>(`/admin/orders/${qs(q)}`), placeholderData: (p) => p })
  const count = (v: string) => (v === 'ready_to_dispatch' ? counts.data?.ready_to_dispatch : counts.data?.dispatched)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <PageHeader title="Deliveries" />
      <Tabs className="mb-4" value={view} onValueChange={(v) => setParams(v === 'ready_to_dispatch' ? {} : { view: String(v) })}>
        <TabsList>
          {TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}{count(v) ? ` (${count(v)})` : ''}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Deliver to</TableHead>
                {view === 'out_for_delivery' ? <><TableHead>Courier</TableHead><TableHead>Expected</TableHead></> : <TableHead>Confirmed</TableHead>}
                <TableHead className="text-right">To collect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((o) => {
                const late = o.expected_delivery_date && o.expected_delivery_date < today
                return (
                  <TableRow key={o.number} className="cursor-pointer" onClick={() => navigate(`/admin/orders/${o.number}`)}>
                    <TableCell>
                      <p className="font-mono font-medium">{o.number}</p>
                      {o.delivery_attempts > 0 && <p className="text-xs text-destructive">{o.delivery_attempts} failed attempt{o.delivery_attempts === 1 ? '' : 's'}</p>}
                    </TableCell>
                    <TableCell><p className="text-sm">{o.customer_name}</p><p className="text-xs text-muted-foreground">{o.phone} · {o.town}, {o.county}</p></TableCell>
                    {view === 'out_for_delivery' ? (
                      <>
                        <TableCell className="text-sm">{o.courier}<p className="text-xs text-muted-foreground">{[o.courier_phone, o.tracking_number].filter(Boolean).join(' · ')}</p></TableCell>
                        <TableCell className={`text-sm ${late ? 'font-medium text-destructive' : ''}`}>{date(o.expected_delivery_date)}{late && ' · late'}</TableCell>
                      </>
                    ) : <TableCell className="text-xs text-muted-foreground">{dateTime(o.created_at)}</TableCell>}
                    <TableCell className="text-right">
                      <p className="tabular-nums">{o.payment_status !== 'paid' ? money(o.total) : '—'}</p>
                      <PaymentPill status={o.payment_status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title={view === 'ready_to_dispatch' ? 'Nothing ready to dispatch' : 'Nothing out for delivery'} />}
      {list.data && <Pager page={page} count={list.data.count} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }} />}
    </>
  )
}
