import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, NativeSelect, PageHeader, Pager, StatCard } from '@/components/common'
import { PaymentPill, StatusPill } from '@/components/OrderStatus'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get, qs } from '@/lib/api'
import { dateTime, money } from '@/lib/format'
import { useMe } from '@/hooks/useAuth'
import { PayoutBalances } from './Payouts'
import type { AdminOrderSummary, OrderRef, Paginated, PaymentRow, PaymentSummary, RefundRow } from '@/lib/types'

const TABS = [['received', 'Received'], ['refunds', 'Refunds'], ['unpaid', 'Unpaid orders'], ['refund_due', 'Refunds due'], ['payouts', 'Supplier payouts']] as const

function OrderCell({ order }: { order: OrderRef }) {
  return (
    <TableCell>
      <Link to={`/admin/orders/${order.number}`} className="font-mono font-medium hover:underline">{order.number}</Link>
      <p className="text-xs text-muted-foreground">{order.customer_name}</p>
    </TableCell>
  )
}

function MoneyRows({ kind, search, page, onPage }: { kind: 'received' | 'refunds'; search: string; page: number; onPage: (p: number) => void }) {
  const q = { search, page }
  const path = kind === 'received' ? '/admin/payments/' : '/admin/refunds/'
  const list = useQuery({ queryKey: ['admin', kind, q], queryFn: () => get<Paginated<PaymentRow & RefundRow & { order: OrderRef }>>(`${path}${qs(q)}`), placeholderData: (p) => p })
  if (list.isLoading) return <Loading />
  if (!list.data?.results.length) return <EmptyState title={kind === 'received' ? 'No payments yet' : 'No refunds yet'} />
  return (
    <>
    <div className="overflow-x-auto surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead><TableHead>Order</TableHead><TableHead className="hidden sm:table-cell">Method</TableHead>
            <TableHead className="hidden md:table-cell">{kind === 'received' ? 'Reference' : 'Reason'}</TableHead>
            <TableHead className="hidden lg:table-cell">By</TableHead><TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data.results.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-muted-foreground">{dateTime(kind === 'received' ? r.received_at : r.refunded_at)}</TableCell>
              <OrderCell order={r.order} />
              <TableCell className="hidden text-sm sm:table-cell">{r.method_display}</TableCell>
              <TableCell className="hidden text-sm md:table-cell">{kind === 'received' ? r.reference || '—' : <>{r.reason}{r.reference && <span className="block text-xs text-muted-foreground">{r.reference}</span>}</>}</TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{r.recorded_by}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{kind === 'refunds' && '−'}{money(r.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <Pager page={page} count={list.data.count} onPage={onPage} />
    </>
  )
}

function OrderRows({ view, page, onPage }: { view: 'unpaid' | 'refund_due'; page: number; onPage: (p: number) => void }) {
  const navigate = useNavigate()
  const q = { view, page }
  const list = useQuery({ queryKey: ['admin', 'orders', q], queryFn: () => get<Paginated<AdminOrderSummary>>(`/admin/orders/${qs(q)}`), placeholderData: (p) => p })
  if (list.isLoading) return <Loading />
  if (!list.data?.results.length) return <EmptyState title={view === 'unpaid' ? 'Every order is paid' : 'No refunds due'} />
  return (
    <>
    <div className="overflow-x-auto surface">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {list.data.results.map((o) => (
            <TableRow key={o.number} className="cursor-pointer" onClick={() => navigate(`/admin/orders/${o.number}`)}>
              <TableCell className="font-mono font-medium">{o.number}</TableCell>
              <TableCell><p className="text-sm">{o.customer_name}</p><p className="text-xs text-muted-foreground">{o.phone}</p></TableCell>
              <TableCell><div className="flex flex-wrap gap-1"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div></TableCell>
              <TableCell className="text-right tabular-nums">{money(o.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <Pager page={page} count={list.data.count} onPage={onPage} />
    </>
  )
}

export default function AdminPayments() {
  const [params, setParams] = useSearchParams()
  const fullAdmin = useMe().data?.admin_scope !== 'orders'
  const tabs = TABS.filter(([v]) => fullAdmin || v !== 'payouts')
  const asked = (params.get('tab') ?? 'received') as (typeof TABS)[number][0]
  const tab = tabs.some(([v]) => v === asked) ? asked : 'received'
  const page = Number(params.get('page') ?? 1)
  const [days, setDays] = useState('30')
  const [search, setSearch] = useState('')
  const summary = useQuery({ queryKey: ['admin', 'payment-summary', days], queryFn: () => get<PaymentSummary>(`/admin/payments/summary/?days=${days}`) })
  const s = summary.data
  const onPage = (p: number) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }

  return (
    <>
      <PageHeader title="Payments" actions={
        <NativeSelect className="w-40" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
        </NativeSelect>
      } />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Received" value={s ? money(s.received) : '…'} hint={s?.by_method.map((m) => `${m.method === 'bank_transfer' ? 'Bank' : 'Cash'} ${money(m.total)}`).join(' · ')} />
        <StatCard label="Refunded" value={s ? money(s.refunded) : '…'} />
        <StatCard label="Still to collect" value={s ? money(s.outstanding) : '…'} hint={s && `${s.outstanding_orders} orders · ${s.delivered_unpaid} delivered`} tone={s && s.delivered_unpaid ? 'warn' : undefined} />
        <StatCard label="Refunds due" value={s ? s.refund_due_orders : '…'} tone={s && s.refund_due_orders ? 'warn' : undefined} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setParams(v === 'received' ? {} : { tab: String(v) })}>
          <TabsList>{tabs.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList>
        </Tabs>
        {(tab === 'received' || tab === 'refunds') && (
          <Input className="ml-auto w-full sm:w-64" placeholder="Order no., reference, customer" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search payments" />
        )}
      </div>
      {tab === 'payouts' ? <PayoutBalances />
        : tab === 'received' || tab === 'refunds'
          ? <MoneyRows kind={tab} search={search} page={page} onPage={onPage} />
          : <OrderRows view={tab} page={page} onPage={onPage} />}
    </>
  )
}
