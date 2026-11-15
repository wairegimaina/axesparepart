import { ArrowRight, Bike, Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useCart } from '@/lib/cart'
import { CONDITION_LABEL, money } from '@/lib/format'
import type { ProductCard as Card } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ProductCard({ product: p }: { product: Card }) {
  const add = useCart((s) => s.add)
  const navigate = useNavigate()
  const [added, setAdded] = useState(false)
  const href = `/products/${p.slug}`
  const onlyCondition = p.conditions.length === 1 && p.conditions[0] !== 'new' ? CONDITION_LABEL[p.conditions[0]] : null
  const fitsText = p.fits.length ? `Fits ${p.fits.slice(0, 2).join(', ')}${p.fits.length > 2 ? ` +${p.fits.length - 2}` : ''}` : null

  const quickAdd = () => {
    if (!p.quick_add) return navigate(href)
    add(p.quick_add.listing_id, p.quick_add.quantity)
    setAdded(true)
    setTimeout(() => setAdded(false), 1600)
    toast.success(`${p.name} added to cart`, { action: { label: 'View cart', onClick: () => navigate('/cart') } })
  }

  return (
    <article className="surface group relative flex flex-col overflow-hidden transition duration-200 hover:-translate-y-1 hover:shadow-[0_18px_40px_-16px_oklch(0.35_0.15_262/0.4)] hover:ring-1 hover:ring-primary/25">
      {/* Whole card opens the product; the cart button sits above this link. */}
      <Link to={href} className="absolute inset-0 z-0" aria-label={p.name} />

      <div className={cn(
        'relative m-2 mb-0 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl',
        p.image ? 'bg-[radial-gradient(circle_at_50%_40%,var(--card),var(--secondary))]' : 'bg-brand text-brand-foreground',
      )}>
        {p.image ? (
          <img src={p.image} alt="" loading="lazy" className="h-full w-full object-contain p-4 mix-blend-multiply dark:mix-blend-normal transition duration-300 group-hover:scale-105" />
        ) : (
          // No photo yet: a branded tile, so it never looks like it's still loading.
          <NoPhoto brand={p.brand.name} type={p.category.name} />
        )}
        <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {p.deal_percent && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">−{p.deal_percent}%</span>}
          {onlyCondition && <span className="rounded-full bg-highlight px-2 py-0.5 text-[11px] font-bold text-highlight-foreground">{onlyCondition}</span>}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-3 pt-3 sm:p-4">
        <p className="text-[11px] font-bold tracking-wider text-primary uppercase">{p.brand.name}</p>
        <h3 className="mt-0.5 line-clamp-2 min-h-[2.6em] font-sans text-[15px] leading-snug font-semibold transition group-hover:text-primary">{p.name}</h3>
        {p.part_number && <p className="mt-0.5 mb-3 truncate font-mono text-[11px] text-muted-foreground">{p.part_number}</p>}
        {fitsText && <p className="-mt-1 mb-3 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Bike className="size-3.5 shrink-0" /><span className="truncate">{fitsText}</span></p>}

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-dashed pt-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-muted-foreground">
              {p.offer_count > 1 ? 'From' : 'Price'}
              {p.was_price && <s className="ml-1.5">{money(p.was_price)}</s>}
            </p>
            <p className={cn('figure truncate text-xl leading-none sm:text-2xl', p.was_price && 'text-red-600 dark:text-red-400')}>{money(p.min_price)}</p>
          </div>
          <button
            type="button"
            onClick={quickAdd}
            aria-label={p.quick_add ? `Add ${p.name} to cart` : `View ${p.name}`}
            className={cn(
              'relative z-10 flex size-9 shrink-0 sm:size-10 items-center justify-center rounded-xl transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              added ? 'bg-emerald-500 text-white'
                : p.quick_add ? 'bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_oklch(0.45_0.2_262/0.6)] hover:scale-105 hover:bg-primary/90'
                  : 'bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground',
            )}
          >
            {added ? <Check className="size-5" /> : p.quick_add ? <Plus className="size-5" /> : <ArrowRight className="size-5" />}
          </button>
        </div>
      </div>
    </article>
  )
}

/** Stand-in for a missing product photo: navy tile with the brand and part type. */
export function NoPhoto({ brand, type, large }: { brand: string; type: string; large?: boolean }) {
  return (
    <>
      <span className="pointer-events-none absolute top-[-30%] right-[6%] h-[160%] w-[6%] rotate-[24deg] bg-primary/60" aria-hidden />
      <span className="pointer-events-none absolute top-[-30%] right-[-1%] h-[160%] w-[1.6%] rotate-[24deg] bg-highlight" aria-hidden />
      <span className="relative flex max-w-[78%] flex-col items-center gap-1 text-center">
        <span className={cn('line-clamp-1 font-heading leading-none font-bold tracking-wide uppercase italic', large ? 'text-5xl sm:text-6xl' : 'text-2xl sm:text-3xl')}>{brand}</span>
        <span className={cn('line-clamp-1 font-semibold tracking-wider text-highlight uppercase', large ? 'text-sm' : 'text-[11px]')}>{type}</span>
      </span>
    </>
  )
}
