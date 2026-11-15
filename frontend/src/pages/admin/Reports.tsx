import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, Loading, PageHeader, StatCard, VerifiedBadge } from '@/components/common'
import { PeriodPicker, usePeriod } from '@/components/PeriodPicker'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get } from '@/lib/api'
import { money } from '@/lib/format'

type Money = string
interface SalesReport {
  granularity: 'day' | 'month'
  orders_placed: number
  orders_by_status: Record<string, number>
  cancellation_rate: number | null
  completed_orders: number
  revenue: Money
  parts_sales: Money
  delivery_fees: Money
  supplier_cost: Money
  parts_margin: Money
  margin_percent: number | null
  average_order: Money | null
  by_payment_method: { method: string; orders: number; revenue: Money }[]
  by_county: { county: string; orders: number; revenue: Money }[]
  series: { period: string; revenue: Money; margin: Money; orders: number; placed: number }[]
}
interface ProductsReport {
  products: { product_id: number; name: string; brand: string; part_number: string; slug: string; units: number; orders: number; revenue: Money; margin: Money }[]
  categories: { category: string; units: number; revenue: Money; margin: Money }[]
}
interface SuppliersReport {
  suppliers: { supplier_id: number; name: string; is_verified: boolean; orders_received: number; orders_fulfilled: number; orders_rejected: number; fulfilment_rate: number | null; hours_to_accept: number | null; hours_to_ready: number | null; units: number; customer_sales: Money; supplier_earnings: Money; margin: Money; balance_owed: Money }[]
}
interface CustomersReport {
  customers_ordering: number
  first_time_customers: number
  customers: { customer_id: number; name: string; email: string; phone: string; orders: number; revenue: Money }[]
}

const TABS = [['sales', 'Sales'], ['products', 'Products'], ['suppliers', 'Suppliers'], ['customers', 'Customers']] as const
const tooltipStyle = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }
const tick = { fontSize: 12, fill: 'var(--muted-foreground)' }
const METHOD = { to_be_agreed: 'To be agreed', cash_on_delivery: 'Cash on delivery', bank_transfer: 'Bank transfer' } as Record<string, string>
const hours = (h: number | null) => (h === null ? '—' : h < 1 ? '< 1 h' : h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`)

function useReport<T>(kind: string, query: string) {
  return useQuery({ queryKey: ['admin', 'report', kind, query], queryFn: () => get<T>(`/admin/reports/${kind}/?${query}`), placeholderData: (p) => p })
}

function MoneyChart({ data, granularity, dataKey, label }: { data: SalesReport['series']; granularity: 'day' | 'month'; dataKey: 'revenue' | 'margin'; label: string }) {
  const rows = data.map((d) => ({
    label: new Date(d.period + 'T00:00').toLocaleDateString('en-KE', granularity === 'day' ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' }),
    value: Number(d[dataKey]),
  }))
  if (!rows.some((r) => r.value)) return <EmptyState title="No completed sales in this period" />
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v))} />
          <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={tooltipStyle} formatter={(v) => [money(Number(v)), label]} />
          <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Sales({ query }: { query: string }) {
  const q = useReport<SalesReport>('sales', query)
  if (!q.data) return <Loading />
  const r = q.data
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue" value={money(r.revenue)} hint={`${r.completed_orders} completed orders`} />
        <StatCard label="Parts margin" value={money(r.parts_margin)} hint={r.margin_percent === null ? undefined : `${r.margin_percent}% of parts sales`} />
        <StatCard label="Average order" value={money(r.average_order)} hint={`Delivery fees ${money(r.delivery_fees)}`} />
        <StatCard label="Orders placed" value={r.orders_placed} hint={r.cancellation_rate === null ? undefined : `${r.cancellation_rate}% cancelled`} tone={r.cancellation_rate && r.cancellation_rate >= 20 ? 'warn' : undefined} />
      </div>
      <section className="mt-6 surface p-5">
        <h2 className="mb-4 font-semibold">Revenue by {r.granularity}</h2>
        <MoneyChart data={r.series} granularity={r.granularity} dataKey="revenue" label="Revenue" />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="mb-3 font-semibold">Money breakdown</h2>
          <dl className="grid gap-1.5 text-sm">
            {[['Parts sales', r.parts_sales], ['Delivery fees', r.delivery_fees], ['Revenue', r.revenue], ['Paid to suppliers', r.supplier_cost], ['Parts margin', r.parts_margin]].map(([l, v], i) => (
              <div key={l} className={`flex justify-between ${i === 2 || i === 4 ? 'border-t pt-1.5 font-semibold' : ''}`}><dt className={i === 2 || i === 4 ? '' : 'text-muted-foreground'}>{l}</dt><dd className="tabular-nums">{money(v)}</dd></div>
            ))}
          </dl>
          {r.by_payment_method.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">By payment method</h3>
              <ul className="grid gap-1 text-sm">
                {r.by_payment_method.map((m) => <li key={m.method} className="flex justify-between"><span className="text-muted-foreground">{METHOD[m.method] ?? m.method} · {m.orders}</span><span className="tabular-nums">{money(m.revenue)}</span></li>)}
              </ul>
            </>
          )}
        </section>
        <section className="surface p-5">
          <h2 className="mb-3 font-semibold">Top counties</h2>
          {r.by_county.length ? (
            <ul className="grid gap-2 text-sm">
              {r.by_county.map((c) => {
                const pct = (100 * Number(c.revenue)) / Number(r.by_county[0].revenue)
                return (
                  <li key={c.county}>
                    <div className="flex justify-between"><span>{c.county} <span className="text-muted-foreground">· {c.orders}</span></span><span className="tabular-nums">{money(c.revenue)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                  </li>
                )
              })}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No completed sales in this period.</p>}
        </section>
      </div>
    </>
  )
}

function Products({ query }: { query: string }) {
  const q = useReport<ProductsReport>('products', query)
  if (!q.data) return <Loading />
  if (!q.data.products.length) return <EmptyState title="No completed sales in this period" />
  return (
    <div className="grid gap-6">
      <div className="overflow-x-auto surface">
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="hidden text-right sm:table-cell">Orders</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="hidden text-right md:table-cell">Margin</TableHead></TableRow></TableHeader>
          <TableBody>
            {q.data.products.map((p) => (
              <TableRow key={p.product_id}>
                <TableCell><Link to={`/products/${p.slug}`} className="font-medium hover:underline">{p.name}</Link><p className="text-xs text-muted-foreground">{p.brand}{p.part_number && ` · ${p.part_number}`}</p></TableCell>
                <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{p.orders}</TableCell>
                <TableCell className="text-right tabular-nums">{money(p.revenue)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{money(p.margin)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <section className="surface p-5">
        <h2 className="mb-3 font-semibold">By category</h2>
        <ul className="grid gap-2 text-sm">
          {q.data.categories.map((c) => (
            <li key={c.category}>
              <div className="flex justify-between"><span>{c.category} <span className="text-muted-foreground">· {c.units} units</span></span><span className="tabular-nums">{money(c.revenue)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(100 * Number(c.revenue)) / Number(q.data!.categories[0].revenue)}%` }} /></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Suppliers({ query }: { query: string }) {
  const q = useReport<SuppliersReport>('suppliers', query)
  if (!q.data) return <Loading />
  if (!q.data.suppliers.length) return <EmptyState title="No supplier activity in this period" />
  return (
    <div className="overflow-x-auto surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Fulfilled</TableHead>
            <TableHead className="hidden text-right md:table-cell">Accepts in</TableHead><TableHead className="hidden text-right md:table-cell">Ready in</TableHead>
            <TableHead className="text-right">Sales</TableHead><TableHead className="hidden text-right lg:table-cell">Margin</TableHead><TableHead className="hidden text-right lg:table-cell">Owed now</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data.suppliers.map((s) => (
            <TableRow key={s.supplier_id}>
              <TableCell><Link to={`/admin/suppliers/${s.supplier_id}`} className="flex items-center gap-1.5 font-medium hover:underline">{s.name}{s.is_verified && <VerifiedBadge />}</Link></TableCell>
              <TableCell className="text-right tabular-nums">{s.orders_received}</TableCell>
              <TableCell className={`text-right tabular-nums ${s.fulfilment_rate !== null && s.fulfilment_rate < 80 ? 'font-medium text-destructive' : ''}`}>{s.fulfilment_rate === null ? '—' : `${s.fulfilment_rate}%`}{s.orders_rejected > 0 && <span className="block text-xs font-normal text-muted-foreground">{s.orders_rejected} rejected</span>}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{hours(s.hours_to_accept)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{hours(s.hours_to_ready)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(s.customer_sales)}</TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{money(s.margin)}</TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell"><Link to={`/admin/payouts/${s.supplier_id}`} className="hover:underline">{money(s.balance_owed)}</Link></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Customers({ query }: { query: string }) {
  const q = useReport<CustomersReport>('customers', query)
  if (!q.data) return <Loading />
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Customers who ordered" value={q.data.customers_ordering} />
        <StatCard label="First-time customers" value={q.data.first_time_customers} />
      </div>
      {q.data.customers.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Spent</TableHead></TableRow></TableHeader>
            <TableBody>
              {q.data.customers.map((c) => (
                <TableRow key={c.customer_id}>
                  <TableCell><Link to={`/admin/customers/${c.customer_id}`} className="font-medium hover:underline">{c.name}</Link><p className="text-xs text-muted-foreground">{c.email}</p></TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{c.phone || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="No completed sales in this period" />}
    </>
  )
}

export default function AdminReports() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') ?? 'sales') as (typeof TABS)[number][0]
  const period = usePeriod()
  return (
    <>
      <PageHeader title="Reports" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => { const n = new URLSearchParams(params); n.set('tab', String(v)); setParams(n, { replace: true }) }}>
          <TabsList>{TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}</TabsList>
        </Tabs>
        <PeriodPicker period={period} csvHref={`/api/admin/reports/${tab}/?${period.query}&export=csv`} />
      </div>
      {tab === 'sales' && <Sales query={period.query} />}
      {tab === 'products' && <Products query={period.query} />}
      {tab === 'suppliers' && <Suppliers query={period.query} />}
      {tab === 'customers' && <Customers query={period.query} />}
      <p className="mt-6 text-xs text-muted-foreground">Sales count orders completed in the period. Orders placed counts every order created in it.</p>
    </>
  )
}
