import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState, Loading, PageHeader } from '@/components/common'
import { StatusPill } from '@/components/OrderStatus'
import { Button } from '@/components/ui/button'
import { get } from '@/lib/api'
import { date, money } from '@/lib/format'
import type { CustomerOrderSummary, Paginated } from '@/lib/types'

export default function Orders() {
  const q = useQuery({ queryKey: ['customer-orders'], queryFn: () => get<Paginated<CustomerOrderSummary>>('/account/orders/?page_size=100') })
  return (
    <>
      <PageHeader title="Your orders" />
      {q.isLoading ? <Loading /> : q.data?.results.length ? (
        <ul className="divide-y surface">
          {q.data.results.map((o) => (
            <li key={o.number}>
              <Link to={`/account/orders/${o.number}`} className="flex items-center gap-4 p-4 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium">{o.number}</p>
                  <p className="text-xs text-muted-foreground">{date(o.created_at)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}</p>
                </div>
                <StatusPill status={o.stage} />
                <span className="w-24 text-right font-medium tabular-nums">{money(o.total)}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No orders yet" action={<Button render={<Link to="/products" />}>Browse parts</Button>} />
      )}
    </>
  )
}
