import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BadgeCheck, Check, FileText, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Loading, Markdown, PageHeader, StatusBadge, SupplierStatusBadge, VerifiedBadge, useBusy } from '@/components/common'
import { ReasonDialog } from '@/components/ReasonDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { get, patch, post } from '@/lib/api'
import { bytes, date, dateTime } from '@/lib/format'
import type { Member, SupplierDocument, SupplierProfile } from '@/lib/types'

interface AdminSupplier extends SupplierProfile {
  documents: SupplierDocument[]
  members: Member[]
  listing_counts: Record<string, number>
  verified_at: string | null
  created_at: string
}

type Pending = null | { kind: 'reject' | 'suspend' } | { kind: 'doc'; id: number }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

/** The supplier's share of the marketplace markup, paid on top of their own price. */
function ShareCard({ supplier, onSaved }: { supplier: AdminSupplier; onSaved: (s: AdminSupplier) => void }) {
  const [value, setValue] = useState(String(Number(supplier.markup_share_percent)))
  const [busy, run] = useBusy()
  const n = Number(value)
  const valid = value.trim() !== '' && n >= 0 && n <= 100
  const changed = valid && n !== Number(supplier.markup_share_percent)
  return (
    <form className="surface p-5" onSubmit={(e) => {
      e.preventDefault()
      run(async () => {
        try {
          onSaved(await patch<AdminSupplier>(`/admin/suppliers/${supplier.id}/`, { markup_share_percent: value }))
          toast.success('Supplier share saved. It applies to new orders.')
        } catch (err) { toast.error((err as Error).message) }
      })
    }}>
      <h2 className="mb-1 font-semibold">Share of markup</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Paid to this supplier on top of their price for every unit sold, as a % of their price. It never exceeds the
        category's markup, and orders already placed keep the share they were placed with.
      </p>
      <div className="flex items-center gap-2">
        <Input className="w-28" type="number" min="0" max="100" step="0.01" inputMode="decimal" aria-label="Share of markup (%)"
          value={value} onChange={(e) => setValue(e.target.value)} />
        <span className="text-sm text-muted-foreground">%</span>
        <Button type="submit" size="sm" disabled={busy || !changed}>Save</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {valid
          ? `Example: their price KES 1,000 in a 20% category. Customer pays 1,200; supplier gets ${(1000 + 10 * Math.min(n, 20)).toLocaleString()}; Axe keeps ${(200 - 10 * Math.min(n, 20)).toLocaleString()}.`
          : 'Enter a percentage from 0 to 100.'}
      </p>
    </form>
  )
}

export default function SupplierDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'supplier', id], queryFn: () => get<AdminSupplier>(`/admin/suppliers/${id}/`) })
  const [pending, setPending] = useState<Pending>(null)
  const [busy, run] = useBusy()
  const s = q.data
  if (!s) return <Loading />

  const act = (path: string, body: object = {}, message = 'Done') =>
    run(async () => {
      try {
        qc.setQueryData(['admin', 'supplier', id], await post<AdminSupplier>(`/admin/suppliers/${id}/${path}/`, body))
        qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] })
        qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
        toast.success(message)
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  const reviewDoc = async (docId: number, status: 'accepted' | 'rejected', note = '') => {
    try {
      await post(`/admin/documents/${docId}/review/`, { status, note })
      qc.invalidateQueries({ queryKey: ['admin', 'supplier', id] })
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const acceptedDocs = s.documents.filter((d) => d.status === 'accepted').length

  return (
    <>
      <Link to="/admin/suppliers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Suppliers
      </Link>
      <PageHeader
        title={s.name}
        description={<span className="flex flex-wrap items-center gap-2"><SupplierStatusBadge status={s.status} />{s.is_verified && <VerifiedBadge />}<span>Added {date(s.created_at)}</span></span>}
        actions={
          <>
            {s.status !== 'approved' && <Button disabled={busy} onClick={() => act('approve', {}, 'Supplier approved')}><Check /> Approve</Button>}
            {s.status === 'pending' && <Button variant="outline" disabled={busy} onClick={() => setPending({ kind: 'reject' })}><X /> Reject</Button>}
            {s.status === 'approved' && !s.is_verified && (
              <Button disabled={busy || !acceptedDocs} title={acceptedDocs ? undefined : 'Accept at least one document first'} onClick={() => act('verify', {}, 'Verified badge awarded')}>
                <BadgeCheck /> Give verified badge
              </Button>
            )}
            {s.is_verified && <Button variant="outline" disabled={busy} onClick={() => act('unverify', {}, 'Badge removed')}>Remove badge</Button>}
            {s.status === 'approved' && <Button variant="outline" disabled={busy} onClick={() => setPending({ kind: 'suspend' })}>Suspend</Button>}
          </>
        }
      />
      {s.status_reason && <p className="mb-6 rounded-lg bg-muted p-3 text-sm"><span className="font-medium">Last decision note:</span> {s.status_reason}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="mb-2 font-semibold">Verification documents</h2>
          {s.documents.length ? (
            <ul className="divide-y">
              {s.documents.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{d.doc_type_display}{d.title && <span className="font-normal text-muted-foreground"> · {d.title}</span>}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.original_name} · {bytes(d.size_bytes)} · {dateTime(d.created_at)}</p>
                      {d.review_note && <p className="mt-1 text-xs">{d.review_note}</p>}
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 pl-8">
                    <Button size="sm" variant="outline" render={<a href={`/api/admin/documents/${d.id}/download/`} target="_blank" rel="noreferrer" />}>Open</Button>
                    {d.status !== 'accepted' && <Button size="sm" variant="secondary" onClick={() => reviewDoc(d.id, 'accepted')}>Accept</Button>}
                    {d.status !== 'rejected' && <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'doc', id: d.id })}>Reject</Button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          )}
        </section>

        <section className="surface p-5">
          <h2 className="mb-2 font-semibold">Company details</h2>
          <dl className="divide-y">
            <Row label="Registration no." value={s.registration_number} />
            <Row label="KRA PIN" value={s.tax_pin} />
            <Row label="Business email" value={s.business_email} />
            <Row label="Business phone" value={s.business_phone} />
            <Row label="Website" value={s.website && <a href={s.website} target="_blank" rel="noreferrer" className="underline">{s.website}</a>} />
            <Row label="Address" value={[s.physical_address, s.town, s.county].filter(Boolean).join(', ')} />
            <Row label="Established" value={s.year_established} />
            <Row label="Sells" value={s.business_categories.map((c) => c.name).join(', ')} />
            <Row label="Brands" value={s.brands_distributed} />
          </dl>
        </section>

        <section className="surface p-5">
          <h2 className="mb-2 font-semibold">About</h2>
          {s.description ? <Markdown>{s.description}</Markdown> : <p className="text-sm text-muted-foreground">Not written yet.</p>}
        </section>

        <section className="grid content-start gap-6">
          <ShareCard supplier={s} onSaved={(next) => qc.setQueryData(['admin', 'supplier', id], next)} />
          <div className="surface p-5">
            <h2 className="mb-2 font-semibold">Listings</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(s.listing_counts).map(([st, n]) => <StatusBadge key={st} status={st} label={`${n} ${st === 'approved' ? 'published' : st}`} />)}
              {!Object.keys(s.listing_counts).length && <p className="text-sm text-muted-foreground">None yet.</p>}
            </div>
            {!!s.listing_counts.pending && <Link to={`/admin/listings?supplier=${s.id}`} className="mt-3 inline-block text-sm text-primary underline">Review pending products</Link>}
          </div>
          <div className="surface p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Team</h2>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => {
                try { toast.success(`Invite sent to ${(await post<{ sent_to: string }>(`/admin/suppliers/${s.id}/resend-invite/`)).sent_to}`) } catch (e) { toast.error((e as Error).message) }
              })}>Resend owner invite</Button>
            </div>
            <ul className="divide-y text-sm">
              {s.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0"><p className="font-medium">{m.full_name}</p><p className="truncate text-xs text-muted-foreground">{m.email}</p></div>
                  <Badge variant="secondary">{m.role}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <ReasonDialog
        open={pending?.kind === 'reject' || pending?.kind === 'suspend'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'suspend' ? 'Suspend supplier' : 'Reject application'}
        description={pending?.kind === 'suspend' ? 'Their products disappear from the marketplace until you approve them again.' : undefined}
        confirmLabel={pending?.kind === 'suspend' ? 'Suspend' : 'Reject'}
        onConfirm={async (reason) => act(pending?.kind === 'suspend' ? 'suspend' : 'reject', { reason }, 'Saved')}
      />
      <ReasonDialog
        open={pending?.kind === 'doc'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Reject document"
        confirmLabel="Reject document"
        onConfirm={async (note) => { if (pending?.kind === 'doc') await reviewDoc(pending.id, 'rejected', note) }}
      />
    </>
  )
}
