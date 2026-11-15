import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { EmptyState, Loading, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { get, post } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { Notification, Paginated } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function Notifications() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => get<Paginated<Notification>>('/notifications/') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={<Button variant="outline" onClick={async () => { await post('/notifications/read_all/'); refresh() }}>Mark all as read</Button>}
      />
      {q.isLoading ? <Loading /> : q.data?.results.length ? (
        <ul className="divide-y surface">
          {q.data.results.map((n) => (
            <li key={n.id} className={cn('flex gap-3 p-4', !n.read_at && 'bg-primary/5')}>
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary')} />
              <div className="min-w-0 flex-1">
                {n.link ? (
                  <Link to={n.link} className="font-medium hover:underline" onClick={() => post(`/notifications/${n.id}/read/`).then(refresh)}>{n.title}</Link>
                ) : (
                  <p className="font-medium">{n.title}</p>
                )}
                {n.body && <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{n.body}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{dateTime(n.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="You're all caught up" />}
    </>
  )
}
