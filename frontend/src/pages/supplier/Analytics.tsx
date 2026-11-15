import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, Loading, PageHeader, StatCard } from '@/components/common'
import { get } from '@/lib/api'
import { money } from '@/lib/format'

interface Analytics {
  top_products: { id: number; name: string; part_number: string; views: number; quantity: number }[]
  sales: {
    sales_total: string
    open_value: string
    orders_by_status: Record<string, number>
    fulfilment_rate: number | null
    monthly: { month: string; total: string; units: number }[]
  }
}

const tooltipStyle = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }
const tick = { fontSize: 12, fill: 'var(--muted-foreground)' }

export default function AnalyticsPage() {
  const q = useQuery({ queryKey: ['supplier', 'analytics'], queryFn: () => get<Analytics>('/supplier/analytics/') })
  if (q.isLoading || !q.data) return <Loading />
  const { sales } = q.data
  const views = q.data.top_products.slice(0, 10).map((p) => ({ ...p, label: p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name }))
  const monthly = sales.monthly.map((m) => ({
    label: new Date(m.month + '-01').toLocaleDateString('en-KE', { month: 'short', year: '2-digit' }),
    total: Number(m.total),
  }))
  const by = sales.orders_by_status
  const completed = (by.collected ?? 0) + (by.completed ?? 0)
  return (
    <>
      <PageHeader title="Analytics" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sales" value={money(sales.sales_total)} hint={`${completed} orders fulfilled`} />
        <StatCard label="In progress" value={money(sales.open_value)} />
        <StatCard label="Fulfilment rate" value={sales.fulfilment_rate === null ? '—' : `${sales.fulfilment_rate}%`} hint={`${by.rejected ?? 0} rejected`} />
        <StatCard label="Cancelled" value={by.cancelled ?? 0} />
      </div>
      <section className="mt-6 surface p-5">
        <h2 className="mb-4 font-semibold">Monthly sales</h2>
        {monthly.length ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                <YAxis tick={tick} axisLine={false} tickLine={false} width={70} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={tooltipStyle} formatter={(v) => [money(Number(v)), 'Sales']} />
                <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyState title="No completed sales yet" />}
      </section>
      <section className="mt-6 surface p-5">
        <h2 className="mb-4 font-semibold">Most viewed products</h2>
        {views.length ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={views} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 12, fill: 'var(--foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="views" name="Views" fill="var(--primary)" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyState title="No views yet" description="Views appear once your products are published." />}
      </section>
    </>
  )
}
