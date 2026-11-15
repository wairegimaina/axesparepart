import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, Loading, NativeSelect, PageHeader, Pager, StatusBadge, useBusy } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMe } from '@/hooks/useAuth'
import { get, post, qs } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { Availability, Listing, Paginated, StockMovement } from '@/lib/types'
import { canEditProducts } from './SupplierLayout'

type Edit = { quantity?: number; supplier_price?: string; availability?: Availability }

function StockTable({ lowOnly }: { lowOnly: boolean }) {
  const { data: me } = useMe()
  const editable = canEditProducts(me)
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [edits, setEdits] = useState<Record<number, Edit>>({})
  const [busy, run] = useBusy()
  const params = { page, page_size: 50, search, low_stock: lowOnly ? 'true' : undefined, ordering: 'quantity' }
  const list = useQuery({
    queryKey: ['supplier', 'listings', 'inventory', params],
    queryFn: () => get<Paginated<Listing>>(`/supplier/listings/${qs(params)}`),
    placeholderData: (p) => p,
  })
  const changed = useMemo(() => Object.entries(edits).filter(([, e]) => Object.keys(e).length), [edits])
  const setEdit = (l: Listing, patch: Edit) => {
    const next = { ...edits[l.id], ...patch }
    if (next.quantity === l.quantity) delete next.quantity
    if (next.supplier_price !== undefined && Number(next.supplier_price) === Number(l.supplier_price)) delete next.supplier_price
    if (next.availability === l.availability) delete next.availability
    setEdits({ ...edits, [l.id]: next })
  }
  const saveAll = () =>
    run(async () => {
      try {
        await post('/supplier/inventory/bulk-update/', { items: changed.map(([id, e]) => ({ id: Number(id), ...e })) })
        toast.success(`Updated ${changed.length} product${changed.length > 1 ? 's' : ''}`)
        setEdits({})
        qc.invalidateQueries({ queryKey: ['supplier'] })
      } catch (e) {
        toast.error((e as Error).message)
      }
    })

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input className="w-full sm:w-64" placeholder="Search products" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search products" />
        {editable && changed.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{changed.length} unsaved</span>
            <Button variant="ghost" onClick={() => setEdits({})}>Discard</Button>
            <Button onClick={saveAll} disabled={busy}>Save all changes</Button>
          </div>
        )}
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader className="max-sm:hidden">
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28">Stock</TableHead>
                <TableHead className="w-36">Your price</TableHead>
                <TableHead className="w-40">Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((l) => {
                const e = edits[l.id] ?? {}
                return (
                  // On phones each product is a small card: name on top, then stock, price and availability side by side.
                  <TableRow key={l.id} className={`max-sm:grid max-sm:grid-cols-[5rem_1fr] max-sm:gap-x-2 max-sm:gap-y-2 max-sm:p-3 max-sm:[&>td]:p-0! ${Object.keys(e).length ? 'bg-primary/5' : ''}`}>
                    <TableCell className="max-sm:col-span-2">
                      <Link to={`/supplier/products/${l.id}`} className="font-medium hover:underline">{l.product.name}</Link>
                      <p className="text-xs text-muted-foreground">{l.sku || l.product.part_number}{l.is_low_stock && <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">Low stock</span>}</p>
                    </TableCell>
                    <TableCell className="max-sm:hidden"><StatusBadge status={l.status} /></TableCell>
                    <TableCell>
                      <span className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Stock</span>
                      <Input type="number" min="0" disabled={!editable} aria-label="Stock" value={e.quantity ?? l.quantity}
                        onChange={(ev) => setEdit(l, { quantity: Math.max(0, Number(ev.target.value || 0)) })} />
                    </TableCell>
                    <TableCell>
                      <span className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Your price (KES)</span>
                      <Input type="number" min="0" step="0.01" disabled={!editable} aria-label="Price" value={e.supplier_price ?? l.supplier_price}
                        onChange={(ev) => setEdit(l, { supplier_price: ev.target.value })} />
                    </TableCell>
                    <TableCell className="max-sm:col-span-2">
                      <NativeSelect disabled={!editable} aria-label="Availability" value={e.availability ?? l.availability} onChange={(ev) => setEdit(l, { availability: ev.target.value as Availability })}>
                        <option value="in_stock">In stock</option>
                        <option value="out_of_stock">Out of stock</option>
                        <option value="on_request">On request</option>
                      </NativeSelect>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={lowOnly ? 'Nothing is low on stock' : 'No products yet'} />
      )}
      {list.data && <Pager page={page} pageSize={50} count={list.data.count} onPage={setPage} />}
    </>
  )
}

const REASON: Record<string, string> = {
  initial: 'Initial stock', manual: 'Manual update', bulk: 'Bulk update', import: 'Bulk import',
  order: 'Order', return: 'Return', correction: 'Count correction',
}

function Movements() {
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: ['supplier', 'movements', page],
    queryFn: () => get<Paginated<StockMovement>>(`/supplier/inventory/movements/?page=${page}`),
  })
  if (q.isLoading) return <Loading />
  if (!q.data?.results.length) return <EmptyState title="No stock changes yet" />
  return (
    <>
      <div className="overflow-x-auto surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">New stock</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.results.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{dateTime(m.created_at)}</TableCell>
                <TableCell><Link to={`/supplier/products/${m.listing}`} className="hover:underline">{m.product_name}</Link></TableCell>
                <TableCell className={`text-right tabular-nums ${m.change > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                  {m.change > 0 ? `+${m.change}` : m.change}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.quantity_after}</TableCell>
                <TableCell>{REASON[m.reason] ?? m.reason}{m.note && <span className="text-muted-foreground"> · {m.note}</span>}</TableCell>
                <TableCell className="text-muted-foreground">{m.user_name ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager page={page} count={q.data.count} onPage={setPage} />
    </>
  )
}

export default function Inventory() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'stock'
  return (
    <>
      <PageHeader title="Inventory" />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'stock' ? {} : { tab: String(v) })} className="mb-4">
        <TabsList>
          <TabsTrigger value="stock">Stock management</TabsTrigger>
          <TabsTrigger value="low">Low stock</TabsTrigger>
          <TabsTrigger value="movements">Stock updates</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'movements' ? <Movements /> : <StockTable key={tab} lowOnly={tab === 'low'} />}
    </>
  )
}
