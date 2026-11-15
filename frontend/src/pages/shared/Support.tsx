import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LifeBuoy, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, ErrorNote, Field, Loading, NativeSelect, PageHeader, useBusy } from '@/components/common'
import { Thread, TICKET_CATEGORIES, TicketStatusPill } from '@/components/support/Thread'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, get, post } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { Paginated, Ticket, TicketCategory, TicketSummary } from '@/lib/types'

/** Help requests for customers (/account/support) and supplier teams (/supplier/support). */
export function SupportList({ base }: { base: string }) {
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => get<Paginated<TicketSummary>>('/support/tickets/') })
  return (
    <>
      <PageHeader title="Help" actions={<Button render={<Link to={`${base}/new`} />}><Plus /> New request</Button>} />
      {q.isLoading ? <Loading /> : q.data?.results.length ? (
        <ul className="divide-y surface">
          {q.data.results.map((t) => (
            <li key={t.number}>
              <Link to={`${base}/${t.number}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{t.number}</span> · {t.category_display}
                    {(t.order_number || t.supplier_order_number) && ` · ${t.order_number ?? t.supplier_order_number}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {dateTime(t.last_message_at)} <TicketStatusPill status={t.status} label={t.status_display} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No help requests" description="Questions about an order, a delivery or your account? Ask us here."
          action={<Button render={<Link to={`${base}/new`} />}><LifeBuoy /> Ask for help</Button>} />
      )}
    </>
  )
}

export function SupportNew({ base }: { base: string }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const order = params.get('order') ?? ''
  const [form, setForm] = useState({ subject: order ? `Order ${order}` : '', category: (order ? 'order' : 'other') as TicketCategory, body: '', order_number: order })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, run] = useBusy()
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })
  return (
    <>
      <Link to={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Help</Link>
      <PageHeader title="New help request" />
      <form
        className="grid max-w-2xl gap-4 surface p-5"
        onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            setErrors({}); setError('')
            try {
              const t = await post<Ticket>('/support/tickets/', form)
              qc.invalidateQueries({ queryKey: ['tickets'] })
              toast.success('Sent. We usually reply within a few hours.')
              navigate(`${base}/${t.number}`, { replace: true })
            } catch (err) {
              if (err instanceof ApiError && err.status === 404) setErrors({ order_number: "We couldn't find that order on your account." })
              else if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields)
              else setError((err as Error).message)
            }
          })
        }}
      >
        <ErrorNote error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What is it about?" htmlFor="t-cat">
            <NativeSelect id="t-cat" value={form.category} onChange={set('category')}>
              {TICKET_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Order number (optional)" htmlFor="t-order" error={errors.order_number}>
            <Input id="t-order" placeholder="AXE-…" value={form.order_number} onChange={set('order_number')} />
          </Field>
        </div>
        <Field label="Subject" htmlFor="t-subject" required error={errors.subject}><Input id="t-subject" value={form.subject} onChange={set('subject')} /></Field>
        <Field label="Message" htmlFor="t-body" required error={errors.body}><Textarea id="t-body" rows={6} value={form.body} onChange={set('body')} /></Field>
        <div><Button type="submit" disabled={busy || !form.subject.trim() || !form.body.trim()}>Send</Button></div>
      </form>
    </>
  )
}

export function SupportDetail({ base, orderBase }: { base: string; orderBase: string }) {
  const { number } = useParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['ticket', number], queryFn: () => get<Ticket>(`/support/tickets/${number}/`), refetchInterval: 30_000 })
  const [body, setBody] = useState('')
  const [busy, run] = useBusy()
  if (q.isLoading) return <Loading />
  if (!q.data) return <ErrorNote error={q.error ?? 'Not found'} />
  const t = q.data
  const linked = t.order_number ?? t.supplier_order_number
  const act = (path: string, payload: object, msg: string) =>
    run(async () => {
      try {
        qc.setQueryData(['ticket', number], await post<Ticket>(`/support/tickets/${number}/${path}/`, payload))
        qc.invalidateQueries({ queryKey: ['tickets'] })
        toast.success(msg)
      } catch (e) { toast.error((e as Error).message) }
    })
  return (
    <>
      <Link to={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Help</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t.subject}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <TicketStatusPill status={t.status} label={t.status_display} />
            <span className="font-mono">{t.number}</span> · {t.category_display}
            {linked && <> · <Link to={`${orderBase}/${linked}`} className="font-mono underline">{linked}</Link></>}
          </p>
        </div>
        {t.status !== 'resolved' && <Button variant="outline" disabled={busy} onClick={() => act('resolve', {}, 'Marked as resolved')}>Mark resolved</Button>}
      </div>
      <div className="max-w-3xl">
        <Thread messages={t.messages} />
        <div className="mt-6 grid gap-2 surface p-4">
          <Textarea rows={3} placeholder={t.status === 'resolved' ? 'Reply to reopen this request' : 'Write a reply'} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Reply" />
          <div><Button disabled={busy || !body.trim()} onClick={() => { act('reply', { body }, 'Sent'); setBody('') }}>Send reply</Button></div>
        </div>
      </div>
    </>
  )
}
