import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { EmptyState, Loading, PageHeader, Pager } from '@/components/common'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { get } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { Paginated } from '@/lib/types'

interface Entry { id: number; actor_email: string | null; action: string; target_type: string; target_id: string; message: string; ip_address: string | null; created_at: string }

export default function Audit() {
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['admin', 'audit', page], queryFn: () => get<Paginated<Entry>>(`/admin/audit-logs/?page=${page}`) })
  return (
    <>
      <PageHeader title="Audit log" />
      {q.isLoading ? <Loading /> : q.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead className="hidden md:table-cell">Note</TableHead></TableRow></TableHeader>
            <TableBody>
              {q.data.results.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{dateTime(e.created_at)}</TableCell>
                  <TableCell className="text-sm">{e.actor_email ?? 'system'}</TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="text-sm">{e.target_type} #{e.target_id}</TableCell>
                  <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground md:table-cell">{e.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="Nothing recorded yet" />}
      {q.data && <Pager page={page} count={q.data.count} onPage={setPage} />}
    </>
  )
}
