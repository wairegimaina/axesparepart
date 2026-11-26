import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, Field, FileButton, Loading, NativeSelect, PageHeader, Pager, StatusBadge, useBusy } from '@/components/common'
import { ProductDetailsFields, productPayload, type ProductDraft } from '@/components/ProductDetailsFields'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError, del, get, patch, post, qs } from '@/lib/api'
import { IMAGE_ACCEPT, MAX_PRODUCT_IMAGES, uploadImages } from '@/lib/imageUpload'
import type { Brand, BusinessCategory, Category, Image, Paginated, Ref, Spec } from '@/lib/types'

interface AdminProduct {
  id: number
  name: string
  slug: string
  part_number: string
  brand: Ref
  category: Ref
  description: string
  specifications: Spec[]
  compatibility: string
  status: 'pending' | 'active' | 'inactive'
  images: Image[]
  listing_count: number
  created_by_supplier_name: string | null
  view_count: number
}

function ProductEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'product', id], queryFn: () => get<AdminProduct>(`/admin/products/${id}/`) })
  const [draft, setDraft] = useState<ProductDraft | null>(null)
  const [status, setStatus] = useState<AdminProduct['status']>('active')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, run] = useBusy()
  const [cutout, setCutout] = useState(true)
  useEffect(() => {
    if (q.data) {
      const p = q.data
      setDraft({ name: p.name, category_id: p.category.id, brand_name: p.brand.name, part_number: p.part_number, description: p.description, specifications: p.specifications, compatibility: p.compatibility })
      setStatus(p.status)
    }
  }, [q.data])
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'product', id] })
    qc.invalidateQueries({ queryKey: ['admin', 'products'] })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit catalogue product</DialogTitle></DialogHeader>
        {!draft || !q.data ? <Loading /> : (
          <div className="grid gap-5">
            <p className="text-xs text-muted-foreground">
              Shared by {q.data.listing_count} listing{q.data.listing_count === 1 ? '' : 's'}. Changes show on every supplier's offer.
              {q.data.created_by_supplier_name && ` First added by ${q.data.created_by_supplier_name}.`}
            </p>
            <ProductDetailsFields value={draft} onChange={setDraft} errors={errors} />
            <Field label="Status" htmlFor="ap-status" >
              <NativeSelect id="ap-status" value={status} onChange={(e) => setStatus(e.target.value as AdminProduct['status'])}>
                <option value="pending">Awaiting first approval</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </NativeSelect>
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium">Catalogue photos</p>
              <div className="flex flex-wrap gap-2">
                {q.data.images.map((img) => (
                  <div key={img.id} className="group relative size-20 overflow-hidden rounded-lg border bg-muted">
                    <img src={img.url} alt="" className="h-full w-full object-contain p-1" />
                    <button type="button" aria-label="Remove" className="absolute top-1 right-1 hidden rounded bg-background/90 p-0.5 group-hover:block"
                      onClick={() => run(async () => { await del(`/admin/products/${id}/images/${img.id}/`); refresh() })}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <FileButton accept={IMAGE_ACCEPT} multiple label="Add photos" icon="image" busy={busy}
                  onFiles={(files) => run(async () => {
                    if (await uploadImages(`/admin/products/${id}/images/`, files, MAX_PRODUCT_IMAGES - q.data!.images.length, { removeBackground: cutout })) refresh()
                  })} />
              </div>
              <div className="mt-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={cutout} onCheckedChange={(v) => setCutout(!!v)} /> Remove backgrounds</label></div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !draft}
            onClick={() => run(async () => {
              setErrors({})
              try {
                await patch(`/admin/products/${id}/`, { ...productPayload(draft!), status })
                toast.success('Product updated')
                refresh()
                onClose()
              } catch (e) {
                if (e instanceof ApiError) setErrors(e.fields)
                toast.error((e as Error).message)
              }
            })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProductsTab() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const editing = params.get('product') ? Number(params.get('product')) : null
  const q = { page, search, status }
  const list = useQuery({ queryKey: ['admin', 'products', q], queryFn: () => get<Paginated<AdminProduct>>(`/admin/products/${qs(q)}`), placeholderData: (p) => p })
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-3">
        <Input className="w-full sm:w-64" placeholder="Name, part no., brand" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search products" />
        <NativeSelect className="w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="pending">Awaiting first approval</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
      </div>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="hidden md:table-cell">Category</TableHead><TableHead className="text-right">Listings</TableHead><TableHead className="hidden text-right sm:table-cell">Views</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.data.results.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setParams({ tab: 'products', product: String(p.id) })}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {p.images[0] ? <img src={p.images[0].url} alt="" className="h-full w-full object-contain" /> : <Wrench className="size-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0"><p className="max-w-64 truncate font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.brand.name}{p.part_number && ` · ${p.part_number}`}</p></div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{p.category.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.listing_count}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{p.view_count}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="No catalogue products" />}
      {list.data && <Pager page={page} count={list.data.count} onPage={setPage} />}
      {editing && <ProductEditor id={editing} onClose={() => setParams({ tab: 'products' })} />}
    </>
  )
}

const pct = (v?: string | null) => (v == null ? '—' : `${Number(v)}%`)

function CategoriesTab() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => get<Category[]>('/admin/categories/') })
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [busy, run] = useBusy()
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'categories'] }); qc.invalidateQueries({ queryKey: ['categories'] }) }
  const cats = list.data ?? []
  const roots = cats.filter((c) => !c.parent)
  const children = (id: number) => cats.filter((c) => c.parent === id)
  const rename = (c: Category) => {
    const next = window.prompt('Category name', c.name)
    if (next && next !== c.name) run(async () => { try { await patch(`/admin/categories/${c.id}/`, { name: next }); refresh() } catch (e) { toast.error((e as Error).message) } })
  }
  const toggle = (c: Category) => run(async () => { await patch(`/admin/categories/${c.id}/`, { is_active: !c.is_active }); refresh() })
  const setMarkup = (c: Category) => {
    const next = window.prompt(
      `Markup % for ${c.name}. Customers pay the supplier's price plus this.\nLeave empty to use ${c.parent ? 'the parent category' : 'the default'} (now ${pct(c.effective_markup_percent)}).`,
      c.markup_percent ?? '')
    if (next === null) return
    const value = next.trim() === '' ? null : next.trim()
    if (value !== null && !(Number(value) >= 0)) { toast.error('Enter a percentage, e.g. 20'); return }
    run(async () => {
      try { await patch(`/admin/categories/${c.id}/`, { markup_percent: value }); refresh(); toast.success('Markup saved') }
      catch (e) { toast.error((e as Error).message) }
    })
  }
  const Item = ({ c, child }: { c: Category; child?: boolean }) => (
    <li className={`flex items-center gap-2 py-1.5 ${child ? 'pl-6' : ''}`}>
      <span className={`flex-1 text-sm ${child ? '' : 'font-medium'} ${c.is_active ? '' : 'text-muted-foreground line-through'}`}>{c.name}</span>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{c.slug}</span>
      <span className={`w-28 text-right text-xs tabular-nums ${c.markup_percent != null ? 'font-semibold' : 'text-muted-foreground'}`}
        title={c.markup_percent != null ? 'Set on this category' : 'Inherited from the parent category or the default'}>
        {pct(c.effective_markup_percent)} markup{c.markup_percent == null && ' ↑'}
      </span>
      <Button size="xs" variant="ghost" onClick={() => setMarkup(c)}>Markup</Button>
      <Button size="xs" variant="ghost" onClick={() => rename(c)}>Rename</Button>
      <Button size="xs" variant="ghost" onClick={() => toggle(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
    </li>
  )
  return (
    <div className="grid gap-4">
      <form className="flex flex-wrap gap-2 surface p-4" onSubmit={(e) => {
        e.preventDefault()
        run(async () => {
          try { await post('/admin/categories/', { name, parent: parent ? Number(parent) : null }); setName(''); refresh(); toast.success('Category added') } catch (err) { toast.error((err as Error).message) }
        })
      }}>
        <Input className="w-full sm:w-56" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Category name" />
        <NativeSelect className="w-full sm:w-56" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent">
          <option value="">Top level</option>
          {roots.map((r) => <option key={r.id} value={r.id}>Inside {r.name}</option>)}
        </NativeSelect>
        <Button type="submit" disabled={busy || !name.trim()}><Plus /> Add</Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Each category can have its own markup. Sub-categories marked ↑ use their parent's, and categories without one use the
        default markup from Settings.
      </p>
      {list.isLoading ? <Loading /> : (
        <ul className="divide-y surface px-4">
          {roots.map((r) => (
            <li key={r.id}>
              <ul><Item c={r} />{children(r.id).map((c) => <Item key={c.id} c={c} child />)}</ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SimpleListTab<T extends { id: number; name: string; is_active: boolean }>({ endpoint, queryKey, label }: { endpoint: string; queryKey: string; label: string }) {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['admin', queryKey],
    queryFn: async () => {
      const data = await get<T[] | Paginated<T>>(`${endpoint}?page_size=200`)
      return Array.isArray(data) ? data : data.results
    },
  })
  const [name, setName] = useState('')
  const [busy, run] = useBusy()
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', queryKey] })
  return (
    <div className="grid gap-4">
      <form className="flex gap-2 surface p-4" onSubmit={(e) => {
        e.preventDefault()
        run(async () => { try { await post(endpoint, { name }); setName(''); refresh() } catch (err) { toast.error((err as Error).message) } })
      }}>
        <Input className="w-full sm:w-64" placeholder={`New ${label}`} value={name} onChange={(e) => setName(e.target.value)} aria-label={label} />
        <Button type="submit" disabled={busy || !name.trim()}><Plus /> Add</Button>
      </form>
      {list.isLoading ? <Loading /> : (
        <ul className="grid gap-1 surface p-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data?.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-muted">
              <span className={`text-sm ${b.is_active ? '' : 'text-muted-foreground line-through'}`}>{b.name}</span>
              <Button size="xs" variant="ghost" onClick={() => run(async () => { await patch(`${endpoint}${b.id}/`, { is_active: !b.is_active }); refresh() })}>
                {b.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Catalogue() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'products'
  return (
    <>
      <PageHeader title="Catalogue" />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) })}>
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Product categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="business">Business categories</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4"><ProductsTab /></TabsContent>
        <TabsContent value="categories" className="mt-4"><CategoriesTab /></TabsContent>
        <TabsContent value="brands" className="mt-4"><SimpleListTab<Brand> endpoint="/admin/brands/" queryKey="brands" label="brand" /></TabsContent>
        <TabsContent value="business" className="mt-4"><SimpleListTab<BusinessCategory> endpoint="/admin/business-categories/" queryKey="business-categories" label="business category" /></TabsContent>
      </Tabs>
    </>
  )
}
