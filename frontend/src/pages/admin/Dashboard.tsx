import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, ChevronRight, Phone, PhoneMissed } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Loading, PageHeader, StatCard } from '@/components/common'
import { StatusPill } from '@/components/OrderStatus'
import { Button } from '@/components/ui/button'
import { useMe } from '@/hooks/useAuth'
import { get } from '@/lib/api'
import { dateTime, money } from '@/lib/format'

interface DashOrder {
  number: string
  customer_name: string
  phone: string
  town: string
  total: string
  status: string
  status_display: string
  created_at: string
  call_attempts: number
  last_call_at: string | null
}

interface Dash {
  suppliers: Record<string, number>
  verified_suppliers: number
  listings: Record<string, number>
  products: Record<string, number>
  pending_documents: number
  pending_deals: number
  customers: number
  orders: Record<string, number>
  rejected_supplier_orders: number
  ready_for_pickup: number
  unpaid_delivered: number
  sales_completed: string
  open_tickets: number
  today: { orders: number; value: string }
  this_week: { orders: number; sales: string }
  to_call: DashOrder[]
  to_call_count: number
  recent_orders: DashOrder[]
}

/** "5 min ago", "3 h ago", or the date for anything older than a day. */
function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`
  return dateTime(iso)
}

export default function AdminDashboard() {
  const { data: me } = useMe()
  const full = me?.admin_scope !== 'orders'
  const { data } = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => get<Dash>('/admin/dashboard/'), refetchInterval: 60_000 })
  if (!data) return <Loading />
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

  const tasks = [
    { label: "Parts suppliers couldn't supply", n: data.rejected_supplier_orders, to: '/admin/orders?status=confirmed' },
    { label: 'Ready for pickup from suppliers', n: data.ready_for_pickup, to: '/admin/deliveries' },
    { label: 'Delivered, payment not recorded', n: data.unpaid_delivered, to: '/admin/orders?status=delivered' },
    { label: 'Open help requests', n: data.open_tickets, to: '/admin/support' },
    ...(full ? [
      { label: 'Products waiting for approval', n: data.listings.pending ?? 0, to: '/admin/listings' },
      { label: 'Supplier documents to check', n: data.pending_documents, to: '/admin/suppliers?status=approved' },
      { label: 'Offers waiting for approval', n: data.pending_deals, to: '/admin/listings?status=offers' },
    ] : []),
  ].filter((t) => t.n > 0)

  return (
    <>
      <PageHeader title={`Hello, ${me?.full_name.split(' ')[0] ?? ''}`} description="Here's what needs doing today." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/admin/orders"><StatCard label="Customers to call" value={data.to_call_count} tone={data.to_call_count ? 'warn' : undefined} hint="Orders waiting for confirmation" /></Link>
        <StatCard label="Orders today" value={data.today.orders} hint={`Worth ${money(data.today.value)}`} />
        <StatCard label="Sales this week" value={money(data.this_week.sales)} hint={`${data.this_week.orders} completed order${data.this_week.orders === 1 ? '' : 's'}`} />
        <Link to="/admin/support"><StatCard label="Help requests" value={data.open_tickets} tone={data.open_tickets ? 'warn' : undefined} hint="Waiting for a reply" /></Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="surface">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2>Call these customers</h2>
            {data.to_call_count > data.to_call.length && (
              <Link to="/admin/orders" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">All {data.to_call_count} <ArrowRight className="size-4" /></Link>
            )}
          </div>
          {data.to_call.length ? (
            <ul className="divide-y">
              {data.to_call.map((o) => (
                <li key={o.number} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-[14rem] flex-1">
                    <p className="font-medium">{o.customer_name} <span className="text-sm font-normal text-muted-foreground">· {o.town}</span></p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{o.number}</span> · {money(o.total)} · placed {ago(o.created_at)}
                    </p>
                    {o.call_attempts > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <PhoneMissed className="size-3.5" /> {o.call_attempts} missed call{o.call_attempts === 1 ? '' : 's'} · last tried {o.last_call_at && ago(o.last_call_at)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" render={<a href={`tel:${o.phone}`} />}><Phone /> {o.phone}</Button>
                    <Button size="sm" render={<Link to={`/admin/orders/${o.number}`} />}>Open</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-emerald-600" /> Everyone has been called. Nice work.</p>
          )}
        </section>

        <section className="surface self-start">
          <h2 className="border-b px-4 py-3">Needs attention</h2>
          {tasks.length ? (
            <ul className="divide-y">
              {tasks.map((t) => (
                <li key={t.label}>
                  <Link to={t.to} className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/60">
                    <span className="figure flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-base text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{t.n}</span>
                    <span className="flex-1">{t.label}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-emerald-600" /> All clear.</p>
          )}
        </section>
      </div>

      <section className="surface mt-6">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2>Recent orders</h2>
          <Link to="/admin/orders?status=" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">All orders <ArrowRight className="size-4" /></Link>
        </div>
        <ul className="divide-y">
          {data.recent_orders.map((o) => (
            <li key={o.number}>
              <Link to={`/admin/orders/${o.number}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-sm transition hover:bg-muted/60 sm:grid-cols-[9rem_1fr_auto_6rem]">
                <span className="font-mono text-xs">{o.number}</span>
                <span className="order-3 truncate sm:order-none">{o.customer_name} <span className="text-muted-foreground">· {ago(o.created_at)}</span></span>
                <span className="order-4 sm:order-none"><StatusPill status={o.status} label={o.status_display} /></span>
                <span className="figure text-right text-base">{money(o.total)}</span>
              </Link>
            </li>
          ))}
          {!data.recent_orders.length && <li className="px-4 py-6 text-sm text-muted-foreground">No orders yet.</li>}
        </ul>
      </section>

      {full && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">Marketplace</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active suppliers" value={data.suppliers.approved ?? 0} hint={`${data.verified_suppliers} verified · ${sum(data.suppliers)} total`} />
            <StatCard label="Parts on sale" value={data.listings.approved ?? 0} hint={`${data.listings.draft ?? 0} drafts in progress`} />
            <StatCard label="Catalogue products" value={data.products.active ?? 0} hint={`${data.products.pending ?? 0} awaiting first approval`} />
            <StatCard label="Customers" value={data.customers} hint={`${data.orders.completed ?? 0} completed orders · ${money(data.sales_completed)}`} />
          </div>
        </>
      )}
    </>
  )
}
