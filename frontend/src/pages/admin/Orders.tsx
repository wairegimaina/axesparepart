import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager } from '@/components/common'
import { PaymentPill, StatusPill } from '@/components/OrderStatus'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get, qs } from '@/lib/api'
import { dateTime, money } from '@/lib/format'
import type { AdminOrderSummary, Paginated } from '@/lib/types'

const TABS = [
  ['pending', 'To verify'], ['confirmed', 'In fulfilment'], ['dispatched', 'Out for delivery'], ['delivered', 'Delivered'],
  ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['', 'All'],
] as const

export default function AdminOrders() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'pending'
  const page = Number(params.get('page') ?? 1)
  const [search, setSearch] = useState('')
  const counts = useQuery({ queryKey: ['admin', 'order-counts'], queryFn: () => get<Record<string, number>>('/admin/orders/counts/') })
  // To verify: never-called first, then whoever we tried longest ago.
  const q = { status, page, search, view: status === 'pending' ? 'to_call' : undefined }
  const list = useQuery({ queryKey: ['admin', 'orders', q], queryFn: () => get<Paginated<AdminOrderSummary>>(`/admin/orders/${qs(q)}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Orders" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setParams(v === 'pending' ? {} : { status: String(v) })}>
          <TabsList>
            {TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}{v && counts.data?.[v] ? ` (${counts.data[v]})` : ''}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <Input className="ml-auto w-full sm:w-64" placeholder="Order no., customer, phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" />
      </div>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead className="hidden sm:table-cell">Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden md:table-cell">Next step</TableHead>
                <TableHead className="hidden lg:table-cell">Placed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((o) => (
                <TableRow key={o.number} className="cursor-pointer" onClick={() => navigate(`/admin/orders/${o.number}`)}>
                  <TableCell><p className="font-mono font-medium">{o.number}</p><p className="text-xs text-muted-foreground">{o.supplier_count} supplier{o.supplier_count === 1 ? '' : 's'}</p>
                    <div className="mt-1.5 grid gap-1 sm:hidden"><p className="text-sm">{o.customer_name} <span className="text-xs text-muted-foreground">· {o.town}</span></p><div className="flex flex-wrap gap-1"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div></div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell"><p className="text-sm">{o.customer_name}</p><p className="text-xs text-muted-foreground">{o.phone} · {o.town}</p></TableCell>
                  <TableCell className="text-right align-top tabular-nums sm:align-middle">{money(o.total)}</TableCell>
                  <TableCell className="hidden sm:table-cell"><div className="flex flex-wrap gap-1"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{o.attention && <span className={o.attention.includes('rejected') ? 'font-medium text-destructive' : o.attention.startsWith('Call again') ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>{o.attention}</span>}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{dateTime(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title={status === 'pending' ? 'No orders waiting to be verified' : 'No orders here'} />}
      {list.data && <Pager page={page} count={list.data.count} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }} />}
    </>
  )
}
