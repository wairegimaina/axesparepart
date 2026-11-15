import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, NativeSelect, Pager } from '@/components/common'
import { ProductCard } from '@/components/ProductCard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { get, qs } from '@/lib/api'
import { categoryIcon } from '@/lib/categoryIcons'
import type { Brand, CategoryNode, Paginated, ProductCard as Card } from '@/lib/types'
import { cn } from '@/lib/utils'

const CONDITIONS = [['', 'Any'], ['new', 'New'], ['refurbished', 'Refurbished'], ['used', 'Used']] as const

type Filters = Record<'q' | 'category' | 'brand' | 'condition' | 'in_stock' | 'deals' | 'sort', string | null> & { page: number }
type SetFilter = (key: string, value: string | null) => void

export function ProductGrid() {
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') ?? 1)
  const filters: Filters = {
    q: params.get('q'), category: params.get('category'), brand: params.get('brand'),
    condition: params.get('condition'), in_stock: params.get('in_stock'), deals: params.get('deals'), sort: params.get('sort'), page,
  }
  const [sheetOpen, setSheetOpen] = useState(false)
  const active = [filters.category, filters.brand, filters.condition, filters.in_stock, filters.deals].filter(Boolean).length
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<CategoryNode[]>('/categories/') })
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => get<Brand[]>('/brands/') })
  const products = useQuery({
    queryKey: ['products', filters],
    queryFn: () => get<Paginated<Card>>(`/products/${qs(filters)}`),
    placeholderData: (prev) => prev,
  })
  const count = products.data?.count

  const set: SetFilter = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next, { replace: true })
  }
  const clearAll = () => {
    const next = new URLSearchParams()
    if (filters.q) next.set('q', filters.q)
    if (filters.sort) next.set('sort', filters.sort)
    setParams(next, { replace: true })
  }

  // Chips for what is switched on, so shoppers see (and undo) filters without opening the panel.
  const allCats = categories.data?.flatMap((c) => [c, ...c.children]) ?? []
  const chips = [
    filters.category && { key: 'category', label: allCats.find((c) => c.slug === filters.category)?.name ?? 'Category' },
    filters.brand && { key: 'brand', label: brands.data?.find((b) => b.slug === filters.brand)?.name ?? 'Brand' },
    filters.condition && { key: 'condition', label: CONDITIONS.find(([v]) => v === filters.condition)?.[1] ?? filters.condition },
    filters.in_stock && { key: 'in_stock', label: 'In stock' },
    filters.deals && { key: 'deals', label: 'On offer' },
  ].filter(Boolean) as { key: string; label: string }[]

  const panel = { filters, set, categories: categories.data ?? [], brands: brands.data ?? [] }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="hidden content-start gap-5 text-sm lg:grid">
        <DesktopCategories {...panel} />
        <OtherFilters {...panel} />
      </aside>

      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="outline" className="lg:hidden" onClick={() => setSheetOpen(true)}>
            <SlidersHorizontal /> Filters
            {active > 0 && <span className="ml-0.5 rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground">{active}</span>}
          </Button>
          <p className="hidden text-sm text-muted-foreground sm:block lg:mr-auto">
            {count !== undefined ? `${count} part${count === 1 ? '' : 's'}` : ' '}
            {filters.q && <> for “<span className="text-foreground">{filters.q}</span>”</>}
          </p>
          <NativeSelect className="ml-auto w-auto min-w-0 max-w-44 lg:ml-0" value={filters.sort ?? ''} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="">Recommended</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="newest">Newest</option>
            <option value="popular">Most viewed</option>
            <option value="deal">Biggest discount</option>
          </NativeSelect>
        </div>
        <p className="mb-3 text-sm text-muted-foreground sm:hidden">
          {count !== undefined ? `${count} part${count === 1 ? '' : 's'}` : ' '}
          {filters.q && <> for “<span className="text-foreground">{filters.q}</span>”</>}
        </p>
        {chips.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <button key={c.key} type="button" onClick={() => set(c.key, null)}
                className="flex items-center gap-1 rounded-full border bg-card py-1 pr-2 pl-3 text-xs font-medium transition hover:border-primary/40 hover:text-primary">
                {c.label} <X className="size-3.5" aria-label={`Remove ${c.label}`} />
              </button>
            ))}
            {chips.length > 1 && <button type="button" onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground hover:underline">Clear all</button>}
          </div>
        )}
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

      {/* Phones: every filter in one bottom sheet. Choices apply straight away; the button shows the result count. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="max-h-[88svh] gap-0 rounded-t-2xl lg:hidden">
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
          <div className="flex items-center justify-between border-b px-4 py-3">
            <SheetTitle className="text-lg font-semibold">Filters</SheetTitle>
            <Button variant="ghost" size="icon-sm" onClick={() => setSheetOpen(false)} aria-label="Close filters"><X /></Button>
          </div>
          <div className="grid gap-6 overflow-y-auto overscroll-contain px-4 py-4 text-sm">
            <MobileCategories {...panel} />
            <OtherFilters {...panel} chips />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-3 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" onClick={clearAll} disabled={active === 0}>Clear all</Button>
            <Button onClick={() => setSheetOpen(false)}>
              {count === undefined ? 'Show parts' : `Show ${count} part${count === 1 ? '' : 's'}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

interface PanelProps { filters: Filters; set: SetFilter; categories: CategoryNode[]; brands: Brand[] }

function DesktopCategories({ filters, set, categories }: PanelProps) {
  return (
    <div>
      <p className="mb-2 font-medium">Category</p>
      <div className="grid gap-0.5">
        <button className={cn('rounded px-2 py-1 text-left hover:bg-muted', !filters.category && 'bg-muted font-medium')} onClick={() => set('category', null)}>
          All categories
        </button>
        {categories.map((c) => (
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
  )
}

/** Phone categories: icon rows that open to show their sub-categories, with a tick on the one chosen. */
function MobileCategories({ filters, set, categories }: PanelProps) {
  const parentOfActive = categories.find((c) => c.slug === filters.category || c.children.some((ch) => ch.slug === filters.category))
  const [open, setOpen] = useState<number | null>(parentOfActive?.id ?? null)
  const row = 'flex w-full items-center gap-3 px-3 py-2.5 text-left'
  return (
    <section>
      <p className="mb-2 font-semibold">Category</p>
      <div className="divide-y overflow-hidden rounded-xl border">
        <button type="button" className={cn(row, !filters.category && 'font-medium text-primary')} onClick={() => set('category', null)}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"><SlidersHorizontal className="size-4" /></span>
          <span className="flex-1">All categories</span>
          {!filters.category && <Check className="size-4" />}
        </button>
        {categories.map((c) => {
          const Icon = categoryIcon(c.name)
          const expanded = open === c.id
          const inside = c === parentOfActive
          return (
            <div key={c.id}>
              <button type="button" className={cn(row, inside && 'font-medium text-primary')} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="size-4" /></span>
                <span className="flex-1">{c.name}</span>
                <ChevronDown className={cn('size-4 text-muted-foreground transition', expanded && 'rotate-180')} />
              </button>
              {expanded && (
                <div className="grid bg-muted/40 py-1">
                  {[{ id: c.id, slug: c.slug, name: `All ${c.name.toLowerCase()}` }, ...c.children].map((ch) => {
                    const on = filters.category === ch.slug
                    return (
                      <button key={ch.id} type="button" onClick={() => set('category', ch.slug)}
                        className={cn('flex items-center gap-3 py-2 pr-3 pl-14 text-left text-muted-foreground', on && 'font-medium text-primary')}>
                        <span className="flex-1">{ch.name}</span>
                        {on && <Check className="size-4" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Brand, condition and the two switches. `chips` lays condition out as tap targets for phones. */
function OtherFilters({ filters, set, brands, chips }: PanelProps & { chips?: boolean }) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={chips ? 'm-brand' : 'brand'} className={cn(chips && 'font-semibold')}>Brand</Label>
        <NativeSelect id={chips ? 'm-brand' : 'brand'} value={filters.brand ?? ''} onChange={(e) => set('brand', e.target.value)}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
        </NativeSelect>
      </div>
      {chips ? (
        <div className="grid gap-2">
          <p className="font-semibold">Condition</p>
          <div className="flex flex-wrap gap-2">
            {CONDITIONS.map(([value, label]) => {
              const on = (filters.condition ?? '') === value
              return (
                <button key={value} type="button" aria-pressed={on} onClick={() => set('condition', value || null)}
                  className={cn('rounded-full border px-3.5 py-1.5 transition', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/40')}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="condition">Condition</Label>
          <NativeSelect id="condition" value={filters.condition ?? ''} onChange={(e) => set('condition', e.target.value)}>
            <option value="">Any condition</option>
            <option value="new">New</option>
            <option value="refurbished">Refurbished</option>
            <option value="used">Used</option>
          </NativeSelect>
        </div>
      )}
      <div className={cn('grid gap-3', chips && 'rounded-xl border p-3')}>
        <label className="flex items-center gap-2">
          <Checkbox checked={filters.in_stock === 'true'} onCheckedChange={(v) => set('in_stock', v ? 'true' : null)} />
          In stock only
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={!!filters.deals} onCheckedChange={(v) => set('deals', v ? '1' : null)} />
          On offer
        </label>
      </div>
    </>
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
