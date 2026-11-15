import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager } from '@/components/common'
import { PaymentPill, StatusPill } from '@/components/OrderStatus'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { get, qs } from '@/lib/api'
import { date, dateTime, money } from '@/lib/format'
import type { Address, AdminOrderSummary, Paginated } from '@/lib/types'

interface CustomerRow { id: number; full_name: string; email: string; phone: string; is_active: boolean; date_joined: string; order_count: number; spent: string }

export function AdminCustomers() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['admin', 'customers', page, search], queryFn: () => get<Paginated<CustomerRow>>(`/admin/customers/${qs({ page, search })}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Customers" />
      <Input className="mb-4 w-full sm:w-72" placeholder="Name, email or phone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search customers" />
      {q.isLoading ? <Loading /> : q.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead className="hidden text-right sm:table-cell">Orders</TableHead><TableHead className="text-right">Spent</TableHead><TableHead className="hidden md:table-cell">Joined</TableHead></TableRow></TableHeader>
            <TableBody>
              {q.data.results.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                  <TableCell><p className="font-medium">{c.full_name}</p><p className="text-xs text-muted-foreground">{c.email}</p><p className="text-xs text-muted-foreground sm:hidden">{c.order_count} order{c.order_count === 1 ? '' : 's'}</p></TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{c.phone || '—'}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.order_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.spent)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{date(c.date_joined)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="No customers yet" />}
      {q.data && <Pager page={page} count={q.data.count} onPage={setPage} />}
    </>
  )
}

interface CustomerDetail { id: number; full_name: string; email: string; phone: string; date_joined: string; last_login: string | null; addresses: Address[]; orders: AdminOrderSummary[] }

export function AdminCustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => get<CustomerDetail>(`/admin/customers/${id}/`) })
  if (!q.data) return <Loading />
  const c = q.data
  return (
    <>
      <Link to="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Customers</Link>
      <PageHeader title={c.full_name} description={`${c.email} · ${c.phone || 'no phone'} · joined ${date(c.date_joined)} · last sign in ${dateTime(c.last_login)}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead className="hidden sm:table-cell">Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="hidden sm:table-cell">Placed</TableHead></TableRow></TableHeader>
            <TableBody>
              {c.orders.map((o) => (
                <TableRow key={o.number} className="cursor-pointer" onClick={() => navigate(`/admin/orders/${o.number}`)}>
                  <TableCell>
                    <p className="font-mono whitespace-nowrap">{o.number}</p>
                    <div className="mt-1 flex flex-wrap gap-1 sm:hidden"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell"><div className="flex flex-wrap gap-1"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div></TableCell>
                  <TableCell className="text-right tabular-nums">{money(o.total)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{date(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!c.orders.length && <p className="p-4 text-sm text-muted-foreground">No orders.</p>}
        </div>
        <aside className="grid content-start gap-3">
          {c.addresses.map((a) => (
            <div key={a.id} className="surface p-3 text-sm">
              <p className="font-medium">{a.label || a.recipient_name}</p>
              <p className="text-muted-foreground">{a.phone}</p>
              <p className="text-muted-foreground">{a.street_address}, {a.town}, {a.county}</p>
            </div>
          ))}
        </aside>
      </div>
    </>
  )
}
