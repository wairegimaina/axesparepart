import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, Search, Send, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ErrorNote, Field, FileButton, Loading, NativeSelect, PageHeader, StatusBadge, useBusy,
} from '@/components/common'
import {
  emptyProduct, ProductDetailsFields, productPayload, type ProductDraft,
} from '@/components/ProductDetailsFields'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/hooks/useAuth'
import { ApiError, del, get, patch, post } from '@/lib/api'
import { date, dateTime, money } from '@/lib/format'
import { IMAGE_ACCEPT, MAX_IMAGE_MB, MAX_PRODUCT_IMAGES, uploadImages } from '@/lib/imageUpload'
import type { CatalogueMatch, Condition, Listing, ListingEvent, Availability } from '@/lib/types'
import { canEditProducts } from './SupplierLayout'

interface OfferDraft {
  sku: string
  condition: Condition
  supplier_price: string
  quantity: string
  min_order_quantity: string
  low_stock_threshold: string
  warranty: string
  availability: Availability
  notes: string
}

const emptyOffer: OfferDraft = {
  sku: '', condition: 'new', supplier_price: '', quantity: '0', min_order_quantity: '1', low_stock_threshold: '',
  warranty: '', availability: 'in_stock', notes: '',
}

function offerFrom(l: Listing): OfferDraft {
  return {
    sku: l.sku, condition: l.condition, supplier_price: l.supplier_price, quantity: String(l.quantity),
    min_order_quantity: String(l.min_order_quantity), low_stock_threshold: l.low_stock_threshold == null ? '' : String(l.low_stock_threshold),
    warranty: l.warranty, availability: l.availability, notes: l.notes,
  }
}

function productFrom(l: Listing | CatalogueMatch): ProductDraft {
  const p = 'product' in l ? l.product : l
  return {
    name: p.name, category_id: p.category.id, brand_name: p.brand.name, part_number: p.part_number,
    description: p.description, specifications: p.specifications, compatibility: p.compatibility,
  }
}

function offerPayload(o: OfferDraft) {
  return {
    sku: o.sku.trim(), condition: o.condition, supplier_price: o.supplier_price, quantity: Number(o.quantity || 0),
    min_order_quantity: Number(o.min_order_quantity || 1),
    low_stock_threshold: o.low_stock_threshold === '' ? null : Number(o.low_stock_threshold),
    warranty: o.warranty, availability: o.availability, notes: o.notes,
  }
}

function OfferFields({ value, onChange, errors, disabled }: { value: OfferDraft; onChange: (v: OfferDraft) => void; errors: Record<string, string>; disabled?: boolean }) {
  const set = <K extends keyof OfferDraft>(k: K, v: OfferDraft[K]) => onChange({ ...value, [k]: v })
  return (
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-3">
      <Field label="Your price (KES)" htmlFor="o-price" required error={errors.supplier_price} hint="What you get paid">
        <Input id="o-price" type="number" min="0" step="0.01" inputMode="decimal" value={value.supplier_price} onChange={(e) => set('supplier_price', e.target.value)} />
      </Field>
      <Field label="Quantity in stock" htmlFor="o-qty" error={errors.quantity}>
        <Input id="o-qty" type="number" min="0" inputMode="numeric" value={value.quantity} onChange={(e) => set('quantity', e.target.value)} />
      </Field>
      <Field label="Minimum order quantity" htmlFor="o-moq" error={errors.min_order_quantity}>
        <Input id="o-moq" type="number" min="1" inputMode="numeric" value={value.min_order_quantity} onChange={(e) => set('min_order_quantity', e.target.value)} />
      </Field>
      <Field label="Condition" htmlFor="o-cond" error={errors.condition} >
        <NativeSelect id="o-cond" value={value.condition} onChange={(e) => set('condition', e.target.value as Condition)}>
          <option value="new">New</option>
          <option value="refurbished">Refurbished</option>
          <option value="used">Used</option>
        </NativeSelect>
      </Field>
      <Field label="Availability" htmlFor="o-avail" error={errors.availability}>
        <NativeSelect id="o-avail" value={value.availability} onChange={(e) => set('availability', e.target.value as Availability)}>
          <option value="in_stock">In stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="on_request">On request</option>
        </NativeSelect>
      </Field>
      <Field label="Warranty" htmlFor="o-warranty" error={errors.warranty}>
        <Input id="o-warranty" placeholder="e.g. 6 months" value={value.warranty} onChange={(e) => set('warranty', e.target.value)} />
      </Field>
      <Field label="SKU (your code)" htmlFor="o-sku" error={errors.sku}>
        <Input id="o-sku" className="font-mono" value={value.sku} onChange={(e) => set('sku', e.target.value)} />
      </Field>
      <Field label="Low-stock alert at" htmlFor="o-low" error={errors.low_stock_threshold} >
        <Input id="o-low" type="number" min="0" value={value.low_stock_threshold} onChange={(e) => set('low_stock_threshold', e.target.value)} />
      </Field>
      <Field label="Notes for customers" htmlFor="o-notes" error={errors.notes} className="sm:col-span-3" >
        <Textarea id="o-notes" rows={2} value={value.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </fieldset>
  )
}

function CatalogueSearch({ onPick }: { onPick: (m: CatalogueMatch) => void }) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300)
    return () => clearTimeout(t)
  }, [term])
  const results = useQuery({
    queryKey: ['catalogue-search', debounced],
    queryFn: () => get<CatalogueMatch[]>(`/supplier/catalogue-search/?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  })
  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Part number or name, e.g. 6205-2RSH" aria-label="Search catalogue" />
      </div>
      {debounced.length >= 2 && results.data && (
        results.data.length ? (
          <ul className="divide-y rounded-lg border">
            {results.data.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.brand.name}{m.part_number && ` · ${m.part_number}`} · {m.category.name}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => onPick(m)}>Sell this part</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No match in the catalogue. Describe it as a new part below.</p>
        )
      )}
    </div>
  )
}

function ImagesManager({ listing, editable, onChange }: { listing: Listing; editable: boolean; onChange: () => void }) {
  const [busy, run] = useBusy()
  const [cutout, setCutout] = useState(true)
  const catalogue = listing.product.images
  const own = listing.images
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {[...catalogue.map((i) => ({ ...i, mine: listing.can_edit_product })), ...own.map((i) => ({ ...i, mine: true }))].map((img) => (
          <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
            <img src={img.url} alt="" className="h-full w-full object-contain p-1" />
            {editable && img.mine && (
              <button
                type="button"
                aria-label="Remove image"
                className="absolute top-1 right-1 hidden rounded-md bg-background/90 p-1 group-hover:block"
                onClick={() => run(async () => { await del(`/supplier/listings/${listing.id}/images/${img.id}/`); onChange() })}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!catalogue.length && !own.length && <p className="text-sm text-muted-foreground">No photos yet. Clear photos get approved faster.</p>}
      {editable && (
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FileButton
            accept={IMAGE_ACCEPT}
            multiple
            label="Add photos"
            icon="image"
            busy={busy}
            onFiles={(files) => run(async () => {
              const count = listing.can_edit_product ? catalogue.length : own.length
              if (await uploadImages(`/supplier/listings/${listing.id}/images/`, files, MAX_PRODUCT_IMAGES - count, { removeBackground: cutout })) onChange()
            })}
          />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={cutout} onCheckedChange={(v) => setCutout(!!v)} /> Remove backgrounds</label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Select several at once. JPG, PNG or WebP, up to {MAX_IMAGE_MB} MB each, {MAX_PRODUCT_IMAGES} photos max. Backgrounds are removed so the part stands out; if a photo can't be cut out cleanly it's kept as it is. Untick to keep the original background.</p>
          {!listing.can_edit_product && <p className="mt-2 text-xs text-muted-foreground">Catalogue photos are shared. Photos you add show with your offer.</p>}
        </div>
      )}
    </div>
  )
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Created', submitted: 'Submitted for approval', approved: 'Approved and published', rejected: 'Rejected',
  reapproval: 'Sent for re-approval', updated: 'Updated', archived: 'Archived', price_set: 'Customer price set', offer: 'Special offer',
}

function History({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['supplier', 'listing', id, 'history'], queryFn: () => get<ListingEvent[]>(`/supplier/listings/${id}/history/`) })
  return (
    <ol className="grid gap-3 text-sm">
      {q.data?.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <p className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</p>
          <p className="text-xs text-muted-foreground">{dateTime(e.created_at)}{e.actor_name && ` · ${e.actor_name}`}</p>
          {e.note && <p className="mt-0.5 text-muted-foreground">{e.note}</p>}
          {Object.keys(e.changes).length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">Changed: {Object.keys(e.changes).map((k) => k.replace('product.', '').replace(/_/g, ' ')).join(', ')}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

const DEAL_TONE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  ended: 'bg-muted text-muted-foreground',
}

/** A percentage off this part. Customers see it on the home page once the marketplace approves it. */
function SpecialOffer({ listing, editable, onChange }: { listing: Listing; editable: boolean; onChange: () => void }) {
  const d = listing.deal
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState({ percent: '10', title: '', ends: '' })
  const [error, setError] = useState<unknown>(null)
  const [busy, run] = useBusy()
  const pct = Math.min(90, Math.max(0, Number(v.percent) || 0))
  const off = (amount: string, digits: number) => (Number(amount) * (100 - pct) / 100).toFixed(digits)

  const submit = () => run(async () => {
    setError(null)
    try {
      await post(`/supplier/listings/${listing.id}/deal/`, {
        percent: pct, title: v.title, ends_at: v.ends ? new Date(`${v.ends}T23:59:59`).toISOString() : null,
      })
      toast.success('Offer sent for approval')
      setEditing(false)
      onChange()
    } catch (e) { setError(e) }
  })
  const end = () => run(async () => {
    try {
      await del(`/supplier/listings/${listing.id}/deal/`)
      toast.success('Offer ended')
      onChange()
    } catch (e) { toast.error((e as Error).message) }
  })

  if (listing.status !== 'approved' && !d) return null
  return (
    <section className="surface p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Tag className="size-4 text-red-600" /> Special offer</h2>
      {d && !editing ? (
        <div className="grid gap-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="figure text-2xl text-red-600">−{d.percent}%</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DEAL_TONE[d.status]}`}>{d.status_display}</span>
          </p>
          {d.title && <p className="font-medium">{d.title}</p>}
          <p className="text-muted-foreground">
            Customers pay <b className="text-foreground">{money(d.customer_price)}</b> <s>{money(listing.customer_price)}</s>.
            You get {money(d.supplier_price)} each.{d.ends_at && ` Ends ${date(d.ends_at)}.`}
          </p>
          {d.status === 'pending' && <p className="text-muted-foreground">We'll check it and put it live, usually the same day.</p>}
          {d.status === 'rejected' && d.note && <p className="rounded-lg bg-red-50 p-2 text-red-800 dark:bg-red-500/10 dark:text-red-200">{d.note}</p>}
          {editable && (
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setV({ percent: String(d.percent), title: d.title, ends: d.ends_at?.slice(0, 10) ?? '' }); setEditing(true) }}>
                {d.status === 'approved' ? 'Change' : 'Edit and resend'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={end}>End offer</Button>
            </div>
          )}
        </div>
      ) : editing ? (
        <div className="mt-3 grid gap-3">
          <ErrorNote error={error} />
          <Field label="Discount (%)" htmlFor="deal-pct" hint="Between 1 and 90. Your price drops by the same percentage.">
            <Input id="deal-pct" type="number" min={1} max={90} value={v.percent} onChange={(e) => setV({ ...v, percent: e.target.value })} />
          </Field>
          <Field label="Offer name (optional)" htmlFor="deal-title"><Input id="deal-title" maxLength={80} placeholder="e.g. Service week" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="Ends on (optional)" htmlFor="deal-ends" hint="Leave empty to run until you end it.">
            <Input id="deal-ends" type="date" min={new Date().toISOString().slice(0, 10)} value={v.ends} onChange={(e) => setV({ ...v, ends: e.target.value })} />
          </Field>
          {pct > 0 && (
            <p className="rounded-lg bg-muted p-2.5 text-sm">
              Customers pay <b>{money(off(listing.customer_price, 0))}</b> instead of {money(listing.customer_price)}. You get {money(off(listing.supplier_price, 2))} each.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || pct < 1} onClick={submit}><Send /> Send for approval</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="text-sm">
          <p className="text-muted-foreground">Put this part on offer. It shows on the home page under Offers once we approve it.</p>
          {editable && <Button size="sm" className="mt-3" onClick={() => setEditing(true)}><Tag /> Run an offer</Button>}
        </div>
      )}
    </section>
  )
}

export default function ProductForm() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const editable = canEditProducts(me)
  const listingQ = useQuery({ queryKey: ['supplier', 'listing', Number(id)], queryFn: () => get<Listing>(`/supplier/listings/${id}/`), enabled: !isNew })
  const listing = listingQ.data

  const [picked, setPicked] = useState<CatalogueMatch | null>(null)
  const [product, setProduct] = useState<ProductDraft>(emptyProduct)
  const [offer, setOffer] = useState<OfferDraft>(emptyOffer)
  const [productErrors, setProductErrors] = useState<Record<string, string>>({})
  const [offerErrors, setOfferErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, run] = useBusy()

  useEffect(() => {
    if (listing) {
      setProduct(productFrom(listing))
      setOffer(offerFrom(listing))
    }
  }, [listing])

  if (!isNew && (listingQ.isLoading || !listing)) return listingQ.error ? <ErrorNote error={listingQ.error} /> : <Loading />

  const productEditable = editable && (isNew ? !picked : !!listing?.can_edit_product) && listing?.status !== 'archived'
  const offerEditable = editable && listing?.status !== 'archived'

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['supplier'] })
  }

  const handleError = (e: unknown) => {
    if (e instanceof ApiError) {
      setProductErrors(e.nested('product_details'))
      const { product_details: _ignored, ...rest } = e.fields
      setOfferErrors(rest)
      setError(Object.keys(e.fields).length ? 'Please fix the highlighted fields.' : e.message)
    } else setError((e as Error).message)
  }

  const save = () =>
    run(async () => {
      setError(''); setProductErrors({}); setOfferErrors({})
      try {
        if (isNew) {
          const body = picked ? { product_id: picked.id, ...offerPayload(offer) } : { product_details: productPayload(product), ...offerPayload(offer) }
          const created = await post<Listing>('/supplier/listings/', body)
          if (created.matched_existing_product) toast.info('This part was already in the catalogue, so your offer was added to it.')
          else toast.success('Saved as draft')
          refresh()
          navigate(`/supplier/products/${created.id}`, { replace: true })
        } else if (listing) {
          const body: Record<string, unknown> = offerPayload(offer)
          if (listing.can_edit_product) {
            const before = productPayload(productFrom(listing))
            const after = productPayload(product)
            if (JSON.stringify(before) !== JSON.stringify(after)) body.product_details = after
          }
          const updated = await patch<Listing>(`/supplier/listings/${listing.id}/`, body)
          qc.setQueryData(['supplier', 'listing', listing.id], updated)
          refresh()
          toast.success(listing.status === 'approved' && updated.status === 'pending' ? 'Saved. This change needs re-approval, so the product is back in the review queue.' : 'Saved')
        }
      } catch (e) {
        handleError(e)
      }
    })

  const act = (path: string, message: string) =>
    run(async () => {
      try {
        const updated = await post<Listing>(`/supplier/listings/${listing!.id}/${path}/`)
        qc.setQueryData(['supplier', 'listing', listing!.id], updated)
        refresh()
        toast.success(message)
      } catch (e) {
        toast.error((e as Error).message)
      }
    })

  const remove = () =>
    run(async () => {
      await del(`/supplier/listings/${listing!.id}/`)
      refresh()
      toast.success(listing!.status === 'draft' ? 'Draft deleted' : 'Product archived')
      navigate('/supplier/products')
    })

  return (
    <>
      <Link to="/supplier/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <PageHeader
        title={isNew ? 'Add product' : listing!.product.name}
        description={!isNew && (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={listing!.status} />
            <span>Customer price {money(listing!.customer_price)}</span>
            <span>· You get {money(listing!.you_receive)} each{Number(listing!.markup_share) > 0 && ` (your price + ${money(listing!.markup_share)} share)`}</span>
            <span>· {listing!.view_count} views</span>
          </span>
        )}
        actions={!isNew && editable && (
          <>
            {(listing!.status === 'draft' || listing!.status === 'rejected') && (
              <Button onClick={() => act('submit', 'Submitted for approval')} disabled={busy}><Send /> Submit for approval</Button>
            )}
            {listing!.status !== 'archived' && (
              <Button variant="outline" onClick={remove} disabled={busy}>
                {listing!.status === 'draft' ? <><Trash2 /> Delete draft</> : <><Archive /> Archive</>}
              </Button>
            )}
          </>
        )}
      />

      {listing?.status === 'rejected' && listing.rejection_reason && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <p className="font-medium">Changes requested by the marketplace</p>
          <p className="mt-1 whitespace-pre-line">{listing.rejection_reason}</p>
          <p className="mt-2 text-xs">Fix the details below, save, then submit again.</p>
        </div>
      )}
      {listing?.status === 'pending' && (
        <p className="mb-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Waiting for marketplace review. You can still update stock and price.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="grid content-start gap-6">
          <ErrorNote error={error} />
          <section className="surface p-5">
            <h2 className="mb-1 font-semibold">Part details</h2>
            {isNew && !picked && (
              <div className="mb-5 rounded-lg bg-muted/60 p-4">
                <p className="mb-2 text-sm">Search first — the part may already be listed.</p>
                <CatalogueSearch onPick={(m) => { setPicked(m); setProduct(productFrom(m)) }} />
              </div>
            )}
            {isNew && picked && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-muted/60 p-3 text-sm">
                <span>Adding your offer to an existing catalogue part.</span>
                <Button size="sm" variant="ghost" onClick={() => { setPicked(null); setProduct(emptyProduct) }}>Describe a new part instead</Button>
              </div>
            )}
            {!isNew && !listing!.can_edit_product && (
              <p className="mb-4 text-sm text-muted-foreground">
                Part details are managed by Axe. You can change your offer below.
              </p>
            )}
            {!isNew && listing!.can_edit_product && listing!.status === 'approved' && (
              <p className="mb-4 text-sm text-muted-foreground">Editing these details sends the product back for approval.</p>
            )}
            <ProductDetailsFields value={product} onChange={setProduct} errors={productErrors} disabled={!productEditable} />
          </section>

          <section className="surface p-5">
            <h2 className="mb-4 font-semibold">Your offer</h2>
            <OfferFields value={offer} onChange={setOffer} errors={offerErrors} disabled={!offerEditable} />
          </section>

          {offerEditable && (
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>{isNew ? 'Save as draft' : 'Save changes'}</Button>
              {isNew && <Button variant="ghost" render={<Link to="/supplier/products" />}>Cancel</Button>}
            </div>
          )}
        </div>

        {!isNew && (
          <aside className="grid content-start gap-6">
            <SpecialOffer listing={listing!} editable={offerEditable} onChange={refresh} />
            <section className="surface p-4">
              <h2 className="mb-3 font-semibold">Photos</h2>
              <ImagesManager listing={listing!} editable={offerEditable} onChange={() => qc.invalidateQueries({ queryKey: ['supplier', 'listing', listing!.id] })} />
            </section>
            <section className="surface p-4">
              <h2 className="mb-3 flex items-center justify-between font-semibold">
                Approval history <Badge variant="secondary">{listing!.status_display}</Badge>
              </h2>
              <History id={listing!.id} />
            </section>
          </aside>
        )}
      </div>
    </>
  )
}
