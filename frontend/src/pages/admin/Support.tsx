import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Mail, Phone } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, ErrorNote, Loading, NativeSelect, PageHeader, Pager, useBusy } from '@/components/common'
import { Thread, TicketStatusPill } from '@/components/support/Thread'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/hooks/useAuth'
import { get, patch, post, qs } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { AdminTicket, AdminTicketSummary, Paginated } from '@/lib/types'

const TABS = [['open', 'Waiting for us'], ['answered', 'Answered'], ['resolved', 'Resolved'], ['', 'All']] as const

export function AdminSupportList() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'open'
  const page = Number(params.get('page') ?? 1)
  const mine = params.get('mine') === '1'
  const [search, setSearch] = useState('')
  const counts = useQuery({ queryKey: ['admin', 'ticket-counts'], queryFn: () => get<Record<string, number>>('/admin/tickets/counts/') })
  const q = { status, page, search, mine: mine ? 1 : undefined }
  const list = useQuery({ queryKey: ['admin', 'tickets', q], queryFn: () => get<Paginated<AdminTicketSummary>>(`/admin/tickets/${qs(q)}`), placeholderData: (p) => p })
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v === null) n.delete(k); else n.set(k, v); n.delete('page'); setParams(n) }

  return (
    <>
      <PageHeader title="Help requests" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setParam('status', v === 'open' ? null : String(v))}>
          <TabsList>
            {TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}{v && counts.data?.[v] ? ` (${counts.data[v]})` : ''}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={mine} onCheckedChange={(v) => setParam('mine', v ? '1' : null)} /> Assigned to me</label>
        <Input className="ml-auto w-full sm:w-64" placeholder="Number, subject, name, order" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search help requests" />
      </div>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Request</TableHead><TableHead className="hidden sm:table-cell">From</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Assigned</TableHead><TableHead className="hidden lg:table-cell">Last message</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((t) => (
                <TableRow key={t.number} className="cursor-pointer" onClick={() => navigate(`/admin/support/${t.number}`)}>
                  <TableCell className="max-w-44 sm:max-w-72">
                    <p className="truncate font-medium">{t.priority === 'high' && <span className="mr-1 text-destructive">●</span>}{t.subject}</p>
                    <p className="text-xs text-muted-foreground"><span className="font-mono">{t.number}</span> · {t.category_display}</p>
                    <p className="text-xs text-muted-foreground sm:hidden">{t.requester.name} · {t.requester.kind === 'supplier' ? 'Supplier' : 'Customer'}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell"><p className="text-sm">{t.requester.name}</p><p className="text-xs text-muted-foreground">{t.requester.kind === 'supplier' ? 'Supplier' : 'Customer'}</p></TableCell>
                  <TableCell><TicketStatusPill status={t.status} label={t.status_display} /></TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{t.assigned_to ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{dateTime(t.last_message_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title={status === 'open' ? 'Nothing waiting for a reply' : 'No help requests here'} />}
      {list.data && <Pager page={page} count={list.data.count} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }} />}
    </>
  )
}

export function AdminSupportDetail() {
  const { number } = useParams()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const q = useQuery({ queryKey: ['admin', 'ticket', number], queryFn: () => get<AdminTicket>(`/admin/tickets/${number}/`), refetchInterval: 30_000 })
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, run] = useBusy()
  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorNote error={q.error ?? 'Not found'} />
  const t = q.data
  const save = (fn: () => Promise<AdminTicket>, msg: string) =>
    run(async () => {
      try {
        qc.setQueryData(['admin', 'ticket', number], await fn())
        qc.invalidateQueries({ queryKey: ['admin', 'tickets'] })
        qc.invalidateQueries({ queryKey: ['admin', 'ticket-counts'] })
        qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
        toast.success(msg)
      } catch (e) { toast.error((e as Error).message) }
    })
  const reply = (resolve: boolean) => {
    save(() => post<AdminTicket>(`/admin/tickets/${number}/reply/`, { body, internal, resolve }), internal ? 'Note added' : resolve ? 'Sent and resolved' : 'Reply sent')
    setBody('')
  }
  const r = t.requester

  return (
    <>
      <Link to="/admin/support" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Help requests</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.subject}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <TicketStatusPill status={t.status} label={t.status_display} /> <span className="font-mono">{t.number}</span> · {t.category_display} · opened {dateTime(t.created_at)}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <Thread messages={t.messages} staffSide />
          <div className="mt-6 grid gap-2 surface p-4">
            <Textarea rows={4} placeholder={internal ? 'Note for the team (the requester never sees it)' : `Reply to ${r.person}`} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />
            <div className="flex flex-wrap items-center gap-2">
              <label className="mr-auto flex items-center gap-2 text-sm"><Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} /> Internal note</label>
              {!internal && <Button variant="outline" disabled={busy || !body.trim()} onClick={() => reply(true)}>Send and resolve</Button>}
              <Button disabled={busy || !body.trim()} onClick={() => reply(false)}>{internal ? 'Add note' : 'Send reply'}</Button>
            </div>
          </div>
        </div>
        <aside className="grid content-start gap-4">
          <section className="surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">{r.kind === 'supplier' ? 'Supplier' : 'Customer'}</h2>
            {r.kind === 'supplier' && me?.admin_scope === 'orders'
              ? <p className="font-medium">{r.name}</p>
              : <Link to={r.kind === 'supplier' ? `/admin/suppliers/${r.id}` : `/admin/customers/${r.id}`} className="font-medium hover:underline">{r.name}</Link>}
            {r.kind === 'supplier' && <p className="text-muted-foreground">{r.person}</p>}
            <a href={`mailto:${r.email}`} className="mt-1 flex items-center gap-1.5 text-muted-foreground hover:underline"><Mail className="size-3.5" /> {r.email}</a>
            {r.phone && <a href={`tel:${r.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:underline"><Phone className="size-3.5" /> {r.phone}</a>}
            {t.order_number && <p className="mt-2">Order <Link to={`/admin/orders/${t.order_number}`} className="font-mono underline">{t.order_number}</Link></p>}
            {t.supplier_order_number && <p className="mt-2">Fulfilment order <span className="font-mono">{t.supplier_order_number}</span></p>}
          </section>
          <section className="grid gap-3 surface p-4 text-sm">
            <label className="grid gap-1 font-medium">Status
              <NativeSelect value={t.status} disabled={busy} onChange={(e) => save(() => patch<AdminTicket>(`/admin/tickets/${number}/`, { status: e.target.value }), 'Status updated')}>
                <option value="open">Waiting for us</option><option value="answered">Answered</option><option value="resolved">Resolved</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 font-medium">Priority
              <NativeSelect value={t.priority} disabled={busy} onChange={(e) => save(() => patch<AdminTicket>(`/admin/tickets/${number}/`, { priority: e.target.value }), 'Priority updated')}>
                <option value="normal">Normal</option><option value="high">High</option>
              </NativeSelect>
            </label>
            <div className="grid gap-1">
              <p className="font-medium">Assigned to</p>
              <p className="text-muted-foreground">{t.assigned_to ?? 'Nobody'}</p>
              {me && t.assigned_to_id !== me.id && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => save(() => patch<AdminTicket>(`/admin/tickets/${number}/`, { assigned_to: me.id }), 'Assigned to you')}>Assign to me</Button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
