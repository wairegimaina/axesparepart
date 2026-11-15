import { useQuery } from '@tanstack/react-query'
import { Check, Circle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Loading, PageHeader, StatCard, SupplierStatusBadge, VerifiedBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useMe } from '@/hooks/useAuth'
import { get } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { SupplierStatus } from '@/lib/types'

interface Dash {
  company_status: SupplierStatus
  is_verified: boolean
  status_reason: string
  profile_completeness: { percent: number; checks: Record<string, boolean> }
  listings_by_status: Record<'draft' | 'pending' | 'approved' | 'rejected', number>
  low_stock: number
  orders: { incoming: number; in_progress: number }
  total_views: number
  units_in_stock: number
  recent_activity: { id: number; action: string; product: string; listing_id: number; note: string; created_at: string }[]
}

const CHECK_LABEL: Record<string, [string, string]> = {
  logo: ['Upload your logo', '/supplier/profile?tab=images'],
  cover_image: ['Add a cover image', '/supplier/profile?tab=images'],
  description: ['Describe your company', '/supplier/profile?tab=about'],
  business_categories: ['Choose what you sell', '/supplier/profile?tab=categories'],
  contact_details: ['Add business phone and email', '/supplier/profile?tab=info'],
  location: ['Add your physical address', '/supplier/profile?tab=info'],
  registration_document: ['Upload business registration certificate', '/supplier/profile?tab=documents'],
  tax_document: ['Upload KRA PIN certificate', '/supplier/profile?tab=documents'],
}
const ACTION_LABEL: Record<string, string> = {
  created: 'Created', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected',
  reapproval: 'Sent for re-approval', updated: 'Updated', archived: 'Archived', price_set: 'Price set by admin',
}

export default function Dashboard() {
  const { data: me } = useMe()
  const { data, isLoading } = useQuery({ queryKey: ['supplier', 'dashboard'], queryFn: () => get<Dash>('/supplier/dashboard/') })
  if (isLoading || !data) return <Loading />
  const pc = data.profile_completeness
  return (
    <>
      <PageHeader
        title={me?.supplier?.name ?? 'Dashboard'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SupplierStatusBadge status={data.company_status} />
            {data.is_verified && <VerifiedBadge />}
          </span>
        }
        actions={<Button render={<Link to="/supplier/products/new" />}>Add product</Button>}
      />
      {data.status_reason && data.company_status !== 'approved' && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <span className="font-medium">Marketplace note:</span> {data.status_reason}
        </p>
      )}
      {data.orders.incoming > 0 && (
        <Link to="/supplier/orders?status=incoming" className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <span className="font-medium">{data.orders.incoming} new order{data.orders.incoming > 1 ? 's' : ''} waiting for you to accept</span>
          <span className="text-sm underline">Open orders</span>
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Orders in progress" value={data.orders.in_progress} hint={<Link to="/supplier/orders?status=accepted" className="underline">View</Link>} />
        <StatCard label="Published" value={data.listings_by_status.approved} />
        <StatCard label="Pending approval" value={data.listings_by_status.pending} hint={`${data.listings_by_status.draft} drafts`} />
        <StatCard label="Low stock" value={data.low_stock} tone={data.low_stock ? 'warn' : undefined} hint={<Link to="/supplier/inventory?tab=low" className="underline">View</Link>} />
        <StatCard label="Product views" value={data.total_views.toLocaleString()} />
      </div>
      {data.listings_by_status.rejected > 0 && (
        <p className="mt-3 text-sm">
          <Link to="/supplier/products?status=rejected" className="text-destructive underline">
            {data.listings_by_status.rejected} product{data.listings_by_status.rejected > 1 ? 's need' : ' needs'} changes
          </Link>
        </p>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {pc.percent < 100 && (
          <section className="surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Complete your storefront</h2>
              <span className="text-sm text-muted-foreground">{pc.percent}%</span>
            </div>
            <Progress value={pc.percent} className="mt-3" />
            <ul className="mt-4 grid gap-2 text-sm">
              {Object.entries(pc.checks).map(([key, done]) => (
                <li key={key} className="flex items-center gap-2">
                  {done ? <Check className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
                  {done ? (
                    <span className="text-muted-foreground line-through">{CHECK_LABEL[key][0]}</span>
                  ) : (
                    <Link to={CHECK_LABEL[key][1]} className="hover:underline">{CHECK_LABEL[key][0]}</Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="surface p-4">
          <h2 className="font-semibold">Recent product activity</h2>
          {data.recent_activity.length ? (
            <ul className="mt-3 divide-y text-sm">
              {data.recent_activity.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link to={`/supplier/products/${e.listing_id}`} className="font-medium hover:underline">{e.product}</Link>
                    <p className="text-muted-foreground">{ACTION_LABEL[e.action] ?? e.action}{e.note && `: ${e.note}`}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{dateTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No activity yet. Add your first product to get started.</p>
          )}
        </section>
      </div>
    </>
  )
}
