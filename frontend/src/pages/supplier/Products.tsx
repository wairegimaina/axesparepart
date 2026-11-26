import { useQuery } from '@tanstack/react-query'
import { Plus, Upload, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMe } from '@/hooks/useAuth'
import { get, qs } from '@/lib/api'
import { CONDITION_LABEL, date, money } from '@/lib/format'
import type { Listing, Paginated } from '@/lib/types'
import { canEditProducts } from './SupplierLayout'

const STATUS_TABS = [
  ['', 'All'], ['draft', 'Drafts'], ['pending', 'Pending approval'], ['approved', 'Published'],
  ['rejected', 'Rejected'], ['archived', 'Archived'],
] as const

export default function Products() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? ''
  const page = Number(params.get('page') ?? 1)
  const [search, setSearch] = useState(params.get('search') ?? '')
  const q = { status, page, search: params.get('search') ?? '' }
  const list = useQuery({
    queryKey: ['supplier', 'listings', q],
    queryFn: () => get<Paginated<Listing>>(`/supplier/listings/${qs(q)}`),
    placeholderData: (p) => p,
  })
  const editable = canEditProducts(me)

  return (
    <>
      <PageHeader
        title="Products"
        actions={
          editable && (
            <>
              <Button variant="outline" render={<Link to="/supplier/products/import" />}><Upload /> Bulk import</Button>
              <Button render={<Link to="/supplier/products/new" />}><Plus /> Add product</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setParams(v ? { status: String(v) } : {})}>
          <TabsList>
            {STATUS_TABS.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <form
          className="ml-auto w-full sm:w-64"
          onSubmit={(e) => {
            e.preventDefault()
            const next = new URLSearchParams(params)
            if (search) next.set('search', search)
            else next.delete('search')
            next.delete('page')
            setParams(next)
          }}
        >
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, part no., SKU" aria-label="Search products" />
        </form>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.data?.results.length ? (
        <div className="overflow-hidden surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="hidden md:table-cell">SKU</TableHead>
                <TableHead className="hidden sm:table-cell">Condition</TableHead>
                <TableHead className="text-right">Your price</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Customer price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((l) => {
                const img = l.product.images[0]?.url ?? l.images[0]?.url
                return (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => navigate(`/supplier/products/${l.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {img ? <img src={img} alt="" className="h-full w-full object-contain" /> : <Wrench className="size-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0">
                          <Link to={`/supplier/products/${l.id}`} className="block max-w-56 truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            {l.product.name}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">{l.product.brand.name} {l.product.part_number && `· ${l.product.part_number}`}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{l.sku || '—'}</TableCell>
                    <TableCell className="hidden sm:table-cell">{CONDITION_LABEL[l.condition]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(l.supplier_price)}
                      {Number(l.markup_share) > 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">you get {money(l.you_receive)}</p>}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums lg:table-cell">{money(l.customer_price)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${l.is_low_stock ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>{l.quantity}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                      {l.deal?.active && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">−{l.deal.percent}%</span>}
                      {l.deal?.status === 'pending' && <span className="ml-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">Offer waiting</span>}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{date(l.updated_at)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title={status ? 'Nothing here' : 'No products yet'}
          description={status ? undefined : 'Add your first spare part, or import your catalogue from Excel.'}
          action={editable && !status && <Button render={<Link to="/supplier/products/new" />}><Plus /> Add product</Button>}
        />
      )}
      {list.data && (
        <Pager page={page} count={list.data.count} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }} />
      )}
    </>
  )
}
