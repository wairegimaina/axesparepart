import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BadgeCheck, Bike, ChevronRight, LayoutGrid, ShieldCheck, Tag, Truck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { NoPhoto, ProductCard } from '@/components/ProductCard'
import { useBrands } from '@/pages/public/Brands'
import { SearchBox } from '@/components/layout/PublicLayout'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { get } from '@/lib/api'
import { categoryIcon } from '@/lib/categoryIcons'
import { money } from '@/lib/format'
import type { CategoryNode, Paginated, ProductCard as Card } from '@/lib/types'

export default function Home() {
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<CategoryNode[]>('/categories/') })
  const latest = useQuery({
    queryKey: ['products', 'home'],
    queryFn: () => get<Paginated<Card>>('/products/?sort=newest&page_size=10'),
  })

  const brands = useBrands()
  const deals = useQuery({
    queryKey: ['products', 'deals'],
    queryFn: () => get<Paginated<Card>>('/products/?deals=1&sort=deal&page_size=8'),
  })

  return (
    <>
      <section className="relative overflow-hidden bg-brand text-brand-foreground">
        <div className="pointer-events-none absolute -top-32 right-[-10%] size-[36rem] rounded-full bg-primary/45 blur-3xl" />
        {/* Diagonal speed stripes, echoing the client's artwork. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 md:block" aria-hidden>
          <div className="absolute top-[-20%] right-[22%] h-[140%] w-10 rotate-[24deg] bg-primary/50" />
          <div className="absolute top-[-20%] right-[8%] h-[140%] w-16 rotate-[24deg] bg-primary/25" />
          <div className="absolute top-[-20%] right-[14%] h-[140%] w-4 rotate-[24deg] bg-highlight" />
        </div>
        <div className="relative mx-auto grid max-w-screen-2xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)] xl:gap-16">
          <div>
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wider text-highlight uppercase">
            <Bike className="size-3.5" /> Motorbike spare parts
          </p>
          <h1 className="max-w-2xl text-5xl leading-[0.95] font-bold uppercase italic sm:text-7xl">
            Genuine spares,<br /><span className="text-highlight">delivered.</span>
          </h1>
          <p className="mt-5 max-w-md text-white/75">Boxer, TVS, Haojin and more. Search by part name, part number or bike model.</p>
          <SearchBox className="mt-8 max-w-xl [&_input]:h-12 [&_input]:rounded-xl [&_input]:text-base [&_svg]:left-3.5 [&_input]:pl-10" />
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm text-white/85">
            <span className="flex items-center gap-2"><BadgeCheck className="size-4 text-highlight" /> Genuine brands</span>
            <span className="flex items-center gap-2"><ShieldCheck className="size-4 text-highlight" /> Quality checked</span>
            <span className="flex items-center gap-2"><Truck className="size-4 text-highlight" /> Delivery countrywide</span>
          </div>
          </div>
          {!!deals.data?.results.length && <HeroOffers deals={deals.data.results} count={deals.data.count} />}
        </div>
      </section>

      {/* Categories: a slim icon row on desktop; on phones one button opens them all in a sheet (no sideways scrolling). */}
      <nav aria-label="Categories" className="border-b bg-card/60">
        <div className="mx-auto max-w-screen-2xl px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
          <div className="lg:hidden">
            <CategorySheet categories={categories.data ?? []} />
          </div>
          <div className="hidden grid-cols-9 gap-1 lg:grid">
            {categories.data?.map((c) => {
              const Icon = categoryIcon(c.name)
              return (
                <Link key={c.id} to={`/products?category=${c.slug}`}
                  className="group flex flex-col items-center gap-2 rounded-xl px-1 py-2 text-center text-[13px] leading-tight font-medium transition hover:bg-primary/5 hover:text-primary">
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="size-5" />
                  </span>
                  {c.name}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-screen-2xl px-4 pt-14 pb-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 [&>*:nth-child(n+9)]:hidden 2xl:[&>*:nth-child(n+9)]:flex">
          {latest.data?.results.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* Brands: a quiet strip of names, not a wall of cards. */}
      {!!brands.data?.length && (
        <section aria-label="Brands" className="border-y bg-card/60">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <span className="hidden shrink-0 text-xs font-semibold tracking-widest text-muted-foreground uppercase md:block">Brands we stock</span>
            <div className="flex flex-1 items-center gap-x-10 gap-y-3 overflow-x-auto [mask-image:linear-gradient(to_right,black_80%,transparent)] [scrollbar-width:none] md:flex-wrap md:justify-center md:[mask-image:none] [&::-webkit-scrollbar]:hidden">
              {brands.data.slice(0, 10).map((b) => (
                <Link key={b.id} to={`/products?brand=${b.slug}`} title={`${b.name} parts`}
                  className="shrink-0 font-heading text-2xl leading-none font-bold whitespace-nowrap text-foreground/35 uppercase italic transition hover:text-primary">
                  {b.logo_url ? <img src={b.logo_url} alt={b.name} className="h-7 w-auto opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0" /> : b.name}
                </Link>
              ))}
            </div>
            <Link to="/brands" className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">All brands <ArrowRight className="size-4" /></Link>
          </div>
        </section>
      )}

      <div className="h-14" />
      <section className="mx-auto max-w-screen-2xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="relative flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10">
          <div className="pointer-events-none absolute top-[-50%] right-[18%] hidden sm:block h-[200%] w-6 rotate-[24deg] bg-highlight" aria-hidden />
          <div className="pointer-events-none absolute top-[-50%] right-[10%] hidden sm:block h-[200%] w-14 rotate-[24deg] bg-white/10" aria-hidden />
          <div className="relative">
            <h2 className="text-3xl font-bold uppercase italic">Can't find your part?</h2>
            <p className="mt-1 text-white/80">Tell us the bike and the part. We'll find it for you.</p>
          </div>
          <Button size="lg" className="relative bg-highlight text-highlight-foreground shadow-none hover:bg-highlight/90" render={<Link to="/help" />}>
            Contact us <ArrowRight />
          </Button>
        </div>
      </section>
    </>
  )
}

/** Supplier offers the admin approved, in the hero: one featured offer at a time, the rest as tiles below it. */
function HeroOffers({ deals, count }: { deals: Card[]; count: number }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const slides = deals.slice(0, 5)
  useEffect(() => {
    if (slides.length < 2 || paused) return
    const t = setInterval(() => setI((n) => (n + 1) % slides.length), 5000)
    return () => clearInterval(t)
  }, [slides.length, paused])
  const best = Math.max(...deals.map((d) => d.deal_percent ?? 0))
  const d = slides[i % slides.length]

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="font-heading text-2xl leading-none font-bold whitespace-nowrap uppercase italic sm:text-3xl">
          <span className="mr-2 inline-flex translate-y-[-2px] items-center gap-1 rounded-md bg-red-600 px-2 py-1 align-middle font-sans text-xs font-bold tracking-wider not-italic"><Tag className="size-3.5" /> Offers</span>
          Save up to <span className="text-highlight">{best}%</span>
        </p>
        <Link to="/products?deals=1&sort=deal" className="flex shrink-0 items-center gap-1 text-sm font-medium text-white/85 hover:text-white">
          {count > 1 ? `All ${count}` : 'View'} <ArrowRight className="size-4" />
        </Link>
      </div>

      <Link key={d.id} to={`/products/${d.slug}`}
        className="group flex animate-in overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_30px_60px_-24px_rgb(0_0_0/0.6)] ring-1 ring-white/10 duration-300 fade-in slide-in-from-right-4">
        <span className={`relative flex w-[44%] shrink-0 items-center justify-center overflow-hidden ${d.image ? 'bg-[radial-gradient(circle_at_50%_40%,var(--card),var(--secondary))]' : 'bg-brand text-brand-foreground'}`}>
          {d.image ? <img src={d.image} alt="" className="h-full max-h-56 w-full object-contain p-4 mix-blend-multiply dark:mix-blend-normal transition duration-300 group-hover:scale-105" /> : <NoPhoto brand={d.brand.name} type={d.category.name} />}
          <span className="absolute top-2.5 left-2.5 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white shadow">−{d.deal_percent}%</span>
        </span>
        <span className="flex min-h-48 min-w-0 flex-1 flex-col p-4 sm:p-5">
          <span className="text-[11px] font-bold tracking-wider text-primary uppercase">{d.brand.name}</span>
          <span className="mt-0.5 line-clamp-2 font-semibold leading-snug group-hover:text-primary">{d.name}</span>
          {d.fits.length > 0 && <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">Fits {d.fits.slice(0, 2).join(', ')}</span>}
          <span className="mt-auto pt-3">
            {d.was_price && <s className="block text-xs text-muted-foreground">{money(d.was_price)}</s>}
            <span className="figure text-3xl leading-none text-red-600 dark:text-red-400">{money(d.min_price)}</span>
          </span>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">View offer <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
        </span>
      </Link>

      {slides.length > 1 && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {slides.map((s, n) => {
            const on = n === i % slides.length
            return (
              <button key={s.id} type="button" aria-label={`Show ${s.name}`} aria-current={on} onClick={() => setI(n)} onMouseEnter={() => setI(n)}
                className={`relative aspect-square overflow-hidden rounded-xl transition ${on ? 'ring-2 ring-highlight' : 'opacity-70 ring-1 ring-white/20 hover:opacity-100'} ${s.image ? 'bg-card' : 'bg-white/10'}`}>
                {s.image
                  ? <img src={s.image} alt="" className="h-full w-full object-contain p-1.5 mix-blend-multiply dark:mix-blend-normal" />
                  : <span className="flex h-full items-center justify-center px-1 text-center font-heading text-[11px] leading-none font-bold uppercase italic">{s.brand.name}</span>}
                <span className="absolute inset-x-0 bottom-0 bg-red-600 py-px text-center text-[10px] font-bold text-white">−{s.deal_percent}%</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Phones: "Shop by category" opens every category as a grid of big icon tiles in a bottom sheet. */
function CategorySheet({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <button type="button" className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left text-sm font-medium shadow-xs transition hover:border-primary/40" />
      }>
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"><LayoutGrid className="size-4" /></span>
        <span className="flex-1">Shop by category</span>
        <span className="text-xs text-muted-foreground">{categories.length || ''}</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </SheetTrigger>
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[88svh] gap-0 rounded-t-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
        <div className="flex items-center justify-between border-b px-4 py-3">
          <SheetTitle className="text-lg font-semibold">Shop by category</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}><X /></SheetClose>
        </div>
        <div className="grid grid-cols-3 gap-2 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {categories.map((c) => {
            const Icon = categoryIcon(c.name)
            return (
              <Link key={c.id} to={`/products?category=${c.slug}`} onClick={() => setOpen(false)}
                className="flex flex-col items-center gap-2 rounded-xl border bg-card px-1 py-3 text-center text-xs leading-tight font-medium transition active:scale-[0.98] hover:border-primary/40 hover:text-primary">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="size-5" /></span>
                {c.name}
              </Link>
            )
          })}
          <Link to="/products" onClick={() => setOpen(false)}
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-1 py-3 text-center text-xs leading-tight font-medium text-primary transition hover:border-primary/40">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground"><ArrowRight className="size-5" /></span>
            All parts
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
