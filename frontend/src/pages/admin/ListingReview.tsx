import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ExternalLink, Tag, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Field, Loading, Markdown, PageHeader, StatusBadge, VerifiedBadge, useBusy } from '@/components/common'
import { ReasonDialog } from '@/components/ReasonDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { get, post } from '@/lib/api'
import { AVAILABILITY_LABEL, CONDITION_LABEL, date, dateTime, money } from '@/lib/format'
import type { AdminListing } from '@/lib/types'

const EVENT_LABEL: Record<string, string> = {
  offer: 'Special offer', created: 'Created', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', reapproval: 'Re-approval needed',
  updated: 'Updated', archived: 'Archived', price_set: 'Customer price set',
}

export default function ListingReview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'listing', id], queryFn: () => get<AdminListing>(`/admin/listings/${id}/`) })
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [rejectingDeal, setRejectingDeal] = useState(false)
  const [busy, run] = useBusy()
  useEffect(() => { if (q.data) setPrice(q.data.price_override ?? '') }, [q.data])
  const l = q.data
  if (!l) return <Loading />

  const done = (updated: AdminListing, message: string, next = false) => {
    qc.setQueryData(['admin', 'listing', id], updated)
    qc.invalidateQueries({ queryKey: ['admin', 'listings'] })
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
    toast.success(message)
    if (next) navigate('/admin/listings')
  }
  const call = (path: string, body: object, message: string, next = false) =>
    run(async () => {
      try {
        done(await post<AdminListing>(`/admin/listings/${id}/${path}/`, body), message, next)
      } catch (e) {
        toast.error((e as Error).message)
      }
    })

  const p = l.product
  const images = [...p.images, ...l.images]
  const markupPrice = l.price_override ? null : l.customer_price

  return (
    <>
      <Link to="/admin/listings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Approvals</Link>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={l.status} />
            <span>by <Link to={`/admin/suppliers/${l.supplier.id}`} className="underline">{l.supplier.name}</Link></span>
            {l.supplier.is_verified && <VerifiedBadge />}
            {l.supplier_status !== 'approved' && <StatusBadge status={l.supplier_status} label={`Supplier ${l.supplier_status}`} />}
          </span>
        }
        actions={l.status === 'approved' && (
          <>
            <Button variant="ghost" render={<a href={`/products/${p.slug}`} target="_blank" rel="noreferrer" />}><ExternalLink /> View live</Button>
            <Button variant="outline" onClick={() => setUnpublishing(true)}>Unpublish</Button>
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-6">
          <section className="surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Catalogue product</h2>
              {p.status === 'pending' ? <StatusBadge status="pending" label="New to catalogue" /> : <StatusBadge status={p.status} />}
            </div>
            {images.length > 0 && (
              <div className="mb-4 flex gap-2 overflow-x-auto">
                {images.map((img) => <a key={img.id} href={img.url} target="_blank" rel="noreferrer"><img src={img.url} alt="" className="size-24 rounded-lg border bg-muted object-contain p-1" /></a>)}
              </div>
            )}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Brand</dt><dd>{p.brand.name}</dd></div>
              <div><dt className="text-muted-foreground">Part number</dt><dd className="font-mono">{p.part_number || '—'}</dd></div>
              <div><dt className="text-muted-foreground">Category</dt><dd>{p.category.name}</dd></div>
              <div><dt className="text-muted-foreground">Catalogue ID</dt><dd><Link className="underline" to={`/admin/catalogue?product=${p.id}`}>#{p.id}, edit details</Link></dd></div>
            </dl>
            {p.description && <div className="mt-4"><Markdown>{p.description}</Markdown></div>}
            {p.specifications.length > 0 && (
              <dl className="mt-4 divide-y rounded-lg border text-sm">
                {p.specifications.map((s) => <div key={s.name} className="grid grid-cols-2 px-3 py-1.5"><dt className="text-muted-foreground">{s.name}</dt><dd>{s.value}</dd></div>)}
              </dl>
            )}
            {p.compatibility && <p className="mt-4 text-sm whitespace-pre-line"><span className="text-muted-foreground">Fits: </span>{p.compatibility}</p>}
          </section>

          <section className="surface p-5">
            <h2 className="mb-3 font-semibold">Supplier's offer</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Condition</dt><dd>{CONDITION_LABEL[l.condition]}</dd></div>
              <div><dt className="text-muted-foreground">Stock</dt><dd>{l.quantity} · {AVAILABILITY_LABEL[l.availability]}</dd></div>
              <div><dt className="text-muted-foreground">Min. order</dt><dd>{l.min_order_quantity}</dd></div>
              <div><dt className="text-muted-foreground">Warranty</dt><dd>{l.warranty || '—'}</dd></div>
              <div><dt className="text-muted-foreground">SKU</dt><dd className="font-mono">{l.sku || '—'}</dd></div>
            </dl>
            {l.notes && <p className="mt-3 text-sm">{l.notes}</p>}
          </section>

          {!!l.other_offers?.length && (
            <section className="surface p-5">
              <h2 className="mb-3 font-semibold">Other suppliers selling this part</h2>
              <Table>
                <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Condition</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Supplier</TableHead><TableHead className="text-right">Customer</TableHead></TableRow></TableHeader>
                <TableBody>
                  {l.other_offers.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell><Link to={`/admin/listings/${o.id}`} className="hover:underline">{o.supplier}</Link></TableCell>
                      <TableCell>{CONDITION_LABEL[o.condition]}</TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{money(o.supplier_price)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(o.customer_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </div>

        <aside className="grid content-start gap-6">
          <section className="surface p-4">
            <h2 className="mb-3 font-semibold">Pricing</h2>
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Supplier price</dt><dd className="tabular-nums">{money(l.supplier_price)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Customer price now</dt><dd className="font-semibold tabular-nums">{money(l.customer_price)}</dd></div>
            </dl>
            <Field label="Set customer price (KES)" htmlFor="price" className="mt-4" hint={markupPrice ? `Empty uses the marketplace markup (${money(markupPrice)})` : 'Clear it to go back to the marketplace markup'}>
              <Input id="price" type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            {l.status !== 'pending' && (
              <Button variant="outline" className="mt-3 w-full" disabled={busy} onClick={() => call('price', { price_override: price || null }, 'Price updated')}>Save price</Button>
            )}
          </section>

          {l.deal && (
            <section className={`surface p-4 ${l.deal.status === 'pending' ? 'ring-2 ring-red-500/40' : ''}`}>
              <h2 className="mb-2 flex items-center justify-between font-semibold">
                <span className="flex items-center gap-2"><Tag className="size-4 text-red-600" /> Special offer</span>
                <span className="text-xs font-medium text-muted-foreground">{l.deal.status_display}</span>
              </h2>
              <p className="figure text-2xl text-red-600">−{l.deal.percent}%{l.deal.title && <span className="ml-2 font-sans text-sm font-medium text-foreground">{l.deal.title}</span>}</p>
              <dl className="mt-2 grid gap-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Customer pays</dt><dd className="tabular-nums"><b>{money(l.deal.customer_price)}</b> <s className="text-muted-foreground">{money(l.customer_price)}</s></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Supplier gets</dt><dd className="tabular-nums">{money(l.deal.supplier_price)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Ends</dt><dd>{l.deal.ends_at ? date(l.deal.ends_at) : 'When the supplier ends it'}</dd></div>
              </dl>
              {l.deal.status === 'rejected' && l.deal.note && <p className="mt-2 text-sm text-muted-foreground">Not approved: {l.deal.note}</p>}
              {l.deal.status === 'pending' && (
                <div className="mt-3 grid gap-2">
                  <Button disabled={busy || l.status !== 'approved'} onClick={() => call('approve-deal', {}, 'Offer is live')}><Check /> Approve offer</Button>
                  <Button variant="outline" disabled={busy} onClick={() => setRejectingDeal(true)}><X /> Don't approve</Button>
                </div>
              )}
            </section>
          )}

          {l.status === 'pending' && (
            <section className="surface p-4">
              <h2 className="mb-3 font-semibold">Decision</h2>
              <Field label="Note to supplier (optional)" htmlFor="note">
                <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="mt-3 grid gap-2">
                <Button disabled={busy || l.supplier_status !== 'approved'} onClick={() => call('approve', { price_override: price || null, note }, 'Approved and published', true)}>
                  <Check /> Approve & publish
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}><X /> Request changes</Button>
              </div>
              {l.supplier_status !== 'approved' && <p className="mt-2 text-xs text-muted-foreground">Approve the supplier first.</p>}
            </section>
          )}

          <section className="surface p-4">
            <h2 className="mb-3 font-semibold">History</h2>
            <ol className="grid gap-3 text-sm">
              {l.events?.map((e) => (
                <li key={e.id} className="border-l-2 pl-3">
                  <p className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</p>
                  <p className="text-xs text-muted-foreground">{dateTime(e.created_at)}{e.actor_name && ` · ${e.actor_name}`}</p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                  {Object.keys(e.changes).length > 0 && (
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {Object.entries(e.changes).map(([k, [a, b]]) => <li key={k}>{k}: {String(a ?? '—')} → {String(b ?? '—')}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <ReasonDialog open={rejecting} onOpenChange={setRejecting} title="Request changes" description="Tell the supplier what to fix." confirmLabel="Send back to supplier"
        onConfirm={async (reason) => call('reject', { reason }, 'Sent back to supplier', true)} />
      <ReasonDialog open={rejectingDeal} onOpenChange={setRejectingDeal} title="Don't approve the offer" description="Tell the supplier why. The part stays on sale at its normal price." confirmLabel="Send to supplier"
        onConfirm={async (reason) => call('reject-deal', { reason }, 'Offer not approved')} />
      <ReasonDialog open={unpublishing} onOpenChange={setUnpublishing} title="Unpublish listing" description="It will be hidden from the shop." confirmLabel="Unpublish" required={false}
        onConfirm={async (reason) => call('unpublish', { reason }, 'Unpublished')} />
    </>
  )
}
