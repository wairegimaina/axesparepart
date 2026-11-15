import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, NativeSelect, Pager } from '@/components/common'
import { ProductCard } from '@/components/ProductCard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { get, qs } from '@/lib/api'
import type { Brand, CategoryNode, Paginated, ProductCard as Card } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ProductGrid() {
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') ?? 1)
  const filters = {
    q: params.get('q'), category: params.get('category'), brand: params.get('brand'),
    condition: params.get('condition'), in_stock: params.get('in_stock'), deals: params.get('deals'), sort: params.get('sort'), page,
  }
  const [showFilters, setShowFilters] = useState(false)
  const active = [filters.category, filters.brand, filters.condition, filters.in_stock, filters.deals].filter(Boolean).length
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<CategoryNode[]>('/categories/') })
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => get<Brand[]>('/brands/') })
  const products = useQuery({
    queryKey: ['products', filters],
    queryFn: () => get<Paginated<Card>>(`/products/${qs(filters)}`),
    placeholderData: (prev) => prev,
  })

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      {/* On phones the filters fold away so the parts show first. */}
      <Button variant="outline" className="justify-self-start lg:hidden" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
        <SlidersHorizontal /> {showFilters ? 'Hide filters' : 'Filters'}{active > 0 && ` (${active})`}
      </Button>
      <aside className={cn('content-start gap-5 text-sm lg:grid', showFilters ? 'surface grid p-4 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none' : 'hidden')}>
        <div>
          <p className="mb-2 font-medium">Category</p>
          <div className="grid gap-0.5">
            <button className={cn('rounded px-2 py-1 text-left hover:bg-muted', !filters.category && 'bg-muted font-medium')} onClick={() => set('category', null)}>
              All categories
            </button>
            {categories.data?.map((c) => (
              <div key={c.id}>
                <button
                  className={cn('w-full rounded px-2 py-1 text-left hover:bg-muted', filters.category === c.slug && 'bg-muted font-medium')}
                  onClick={() => set('category', c.slug)}
                >
                  {c.name}
                </button>
                {(filters.category === c.slug || c.children.some((ch) => ch.slug === filters.category)) &&
                  c.children.map((ch) => (
                    <button
                      key={ch.id}
                      className={cn('w-full rounded py-1 pr-2 pl-5 text-left text-muted-foreground hover:bg-muted', filters.category === ch.slug && 'bg-muted font-medium text-foreground')}
                      onClick={() => set('category', ch.slug)}
                    >
                      {ch.name}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="brand">Brand</Label>
          <NativeSelect id="brand" value={filters.brand ?? ''} onChange={(e) => set('brand', e.target.value)}>
            <option value="">All brands</option>
            {brands.data?.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="condition">Condition</Label>
          <NativeSelect id="condition" value={filters.condition ?? ''} onChange={(e) => set('condition', e.target.value)}>
            <option value="">Any condition</option>
            <option value="new">New</option>
            <option value="refurbished">Refurbished</option>
            <option value="used">Used</option>
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2">
          <Checkbox checked={filters.in_stock === 'true'} onCheckedChange={(v) => set('in_stock', v ? 'true' : null)} />
          In stock only
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={!!filters.deals} onCheckedChange={(v) => set('deals', v ? '1' : null)} />
          On offer
        </label>
      </aside>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {products.data ? `${products.data.count} part${products.data.count === 1 ? '' : 's'}` : ' '}
            {filters.q && <> for “<span className="text-foreground">{filters.q}</span>”</>}
          </p>
          <NativeSelect className="w-44" value={filters.sort ?? ''} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="">Recommended</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="newest">Newest</option>
            <option value="popular">Most viewed</option>
            <option value="deal">Biggest discount</option>
          </NativeSelect>
        </div>
        {products.isLoading ? (
          <Loading />
        ) : products.data?.results.length ? (
          <>
            <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5', products.isFetching && 'opacity-60')}>
              {products.data.results.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
            <Pager
              page={page}
              count={products.data.count}
              onPage={(p) => {
                const next = new URLSearchParams(params)
                next.set('page', String(p))
                setParams(next)
                window.scrollTo({ top: 0 })
              }}
            />
          </>
        ) : (
          <EmptyState title="No parts match" description="Try a different part number, brand or category." />
        )}
      </div>
    </div>
  )
}

export default function Products() {
  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Spare parts</h1>
      <ProductGrid />
    </div>
  )
}
