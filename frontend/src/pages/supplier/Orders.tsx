import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager } from '@/components/common'
import { StatusPill } from '@/components/OrderStatus'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get, qs } from '@/lib/api'
import { dateTime, money } from '@/lib/format'
import type { Paginated, SupplierOrderSummary } from '@/lib/types'

const TABS = [['incoming', 'Incoming'], ['accepted', 'Accepted'], ['processing', 'Processing'], ['completed', 'Completed'], ['closed', 'Rejected / cancelled']] as const

export default function SupplierOrders() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = params.get('status') ?? 'incoming'
  const page = Number(params.get('page') ?? 1)
  const counts = useQuery({ queryKey: ['supplier', 'order-counts'], queryFn: () => get<Record<string, number>>('/supplier/orders/counts/') })
  const list = useQuery({
    queryKey: ['supplier', 'orders', tab, page],
    queryFn: () => get<Paginated<SupplierOrderSummary>>(`/supplier/orders/${qs({ status: tab, page })}`),
    placeholderData: (p) => p,
  })
  return (
    <>
      <PageHeader title="Orders" />
      <Tabs value={tab} onValueChange={(v) => setParams({ status: String(v) })} className="mb-4">
        <TabsList>
          {TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}{counts.data?.[v] ? ` (${counts.data[v]})` : ''}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Received</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Your total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.data.results.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(`/supplier/orders/${o.number}`)}>
                  <TableCell className="font-mono font-medium">{o.number}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{dateTime(o.released_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.item_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(o.supplier_total)}</TableCell>
                  <TableCell><StatusPill status={o.status} label={o.status_display} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title={tab === 'incoming' ? 'No new orders' : 'Nothing here'} description={tab === 'incoming' ? "We'll notify you as soon as an order comes in." : undefined} />}
      {list.data && <Pager page={page} count={list.data.count} onPage={(p) => setParams({ status: tab, page: String(p) })} />}
    </>
  )
}
