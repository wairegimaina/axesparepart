import { useQuery } from '@tanstack/react-query'
import { usePageMeta } from '@/hooks/usePageMeta'
import { ArrowRight, LayoutGrid, Tag, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import heroLarge from '@/assets/hero-offroad-1920.webp'
import heroSmall from '@/assets/hero-offroad-960.webp'
import { ProductCard } from '@/components/ProductCard'
import { useBrands } from '@/pages/public/Brands'
import { SearchBox } from '@/components/layout/PublicLayout'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { get } from '@/lib/api'
import { categoryIcon } from '@/lib/categoryIcons'
import type { CategoryNode, Paginated, ProductCard as Card } from '@/lib/types'

/** Quick searches under the hero search box. */
const POPULAR = ['Brake pads', 'Boxer BM150', 'Chain & sprocket']

export default function Home() {
  usePageMeta('')
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
  // The hero photo is a wheel, so its one link goes to that category when the shop has it.
  const wheels = categories.data?.find((c) => /wheel|tyre|tire/i.test(c.name))

  return (
    <>
      {/* Hero: an off-road photo under a navy fade. Phones: photo on top, text below. Desktop: text left, wheel right. */}
      <section id="home-hero" className="relative overflow-hidden bg-brand text-brand-foreground">
        <img
          src={heroLarge}
          srcSet={`${heroSmall} 960w, ${heroLarge} 1920w`}
          sizes="100vw"
          alt=""
          aria-hidden
          fetchPriority="high"
          className="absolute inset-x-0 top-0 h-[330px] w-full object-cover object-[78%_40%] saturate-[1.1] contrast-[1.08] md:inset-0 md:h-full md:object-[75%_50%]"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[330px] bg-[#0b2a8a] opacity-20 mix-blend-color md:inset-0 md:h-full" aria-hidden />
        {/* Phones: fade the photo down into navy so the headline sits on solid colour. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[332px] bg-[linear-gradient(180deg,rgb(11_27_63/0.2)_0%,transparent_35%,rgb(11_27_63/0.7)_75%,var(--brand)_100%)] md:hidden" aria-hidden />
        {/* Desktop: navy behind the text on the left, the wheel clear on the right, a blue glow from the corner. */}
        <div className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(90deg,var(--brand)_0%,rgb(11_27_63/0.95)_30%,rgb(11_27_63/0.55)_52%,transparent_78%)] md:block" aria-hidden />
        <div className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(ellipse_50%_65%_at_100%_100%,rgb(29_79_216/0.5),transparent_70%)] md:block" aria-hidden />
        <div className="pointer-events-none absolute inset-0 hidden shadow-[inset_0_-120px_120px_-40px_rgb(11_27_63/0.9),inset_0_0_160px_rgb(5_12_30/0.5)] md:block" aria-hidden />

        <div className="relative mx-auto grid max-w-screen-2xl gap-8 px-5 pt-[200px] pb-8 sm:px-6 md:grid-cols-2 md:items-center md:py-28 lg:px-8 lg:py-32">
          <div>
            <h1 className="text-[54px] leading-[0.92] font-extrabold tracking-[-0.01em] uppercase italic sm:text-7xl lg:text-[88px]">
              Genuine spares,<br /><span className="text-highlight">delivered.</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/80 sm:mt-6 sm:text-[17px]">Boxer, TVS, Haojin and more. Search by part name, part number or bike model.</p>
            <SearchBox
              className="mt-6 max-w-xl sm:mt-8 [&_input]:h-14 [&_input]:rounded-2xl [&_input]:border-0 [&_input]:pl-11 [&_input]:text-base [&_input]:shadow-[0_20px_40px_-18px_rgb(0_0_0/0.6)] [&_svg]:left-4"
            />
            <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 text-[13px] whitespace-nowrap [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
              <span className="hidden self-center text-white/60 sm:inline">Popular:</span>
              {POPULAR.map((q) => (
                <Link key={q} to={`/products?q=${encodeURIComponent(q)}`} className="rounded-full bg-white/10 px-3.5 py-2 text-white transition hover:bg-white/20 sm:px-3 sm:py-1">{q}</Link>
              ))}
            </div>
          </div>
          {wheels && (
            <div className="hidden self-end justify-self-end md:block">
              <Link to={`/products?category=${wheels.slug}`}
                className="inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/10 py-2 pr-2 pl-5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/20">
                Shop {wheels.name.toLowerCase()}
                <span className="flex size-9 items-center justify-center rounded-full bg-primary"><ArrowRight className="size-4" /></span>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Categories: a slim icon row on desktop; on phones a 4-column grid, the last tile opens the full list. */}
      <nav aria-label="Categories" className="border-b bg-card">
        <div className="mx-auto max-w-screen-2xl px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-1 sm:grid-cols-8 lg:hidden">
            {categories.data?.slice(0, 7).map((c) => <CategoryTile key={c.id} category={c} />)}
            <CategorySheet categories={categories.data ?? []} />
          </div>
          <div className="hidden grid-cols-9 gap-1 lg:grid">
            {categories.data?.map((c) => <CategoryTile key={c.id} category={c} />)}
          </div>
        </div>
      </nav>

      {!!deals.data?.results.length && (
        <section aria-label="Offers" className="mx-auto max-w-screen-2xl px-4 pt-12 sm:px-6 lg:px-8">
          <SectionHead
            kicker={<span className="inline-flex items-center gap-1 text-red-600"><Tag className="size-3.5" /> Offers</span>}
            title={<>Save up to <span className="text-primary">{Math.max(...deals.data.results.map((d) => d.deal_percent ?? 0))}%</span></>}
            link={{ to: '/products?deals=1&sort=deal', label: deals.data.count > 1 ? `All ${deals.data.count} offers` : 'View offer' }}
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 [&>*:nth-child(n+5)]:hidden md:[&>*:nth-child(n+4)]:hidden lg:[&>*:nth-child(4)]:flex 2xl:[&>*:nth-child(5)]:flex">
            {deals.data.results.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-screen-2xl px-4 pt-12 pb-14 sm:px-6 lg:px-8">
        <SectionHead kicker="Just in" title="Latest parts" link={{ to: '/products?sort=newest', label: 'View all parts' }} />
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

/** Small blue label, big italic title and a "view all" link above a product grid. */
function SectionHead({ kicker, title, link }: { kicker: ReactNode; title: ReactNode; link: { to: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">{kicker}</p>
        <h2 className="mt-1 text-3xl leading-none font-bold uppercase italic sm:text-4xl">{title}</h2>
      </div>
      <Link to={link.to} className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        {link.label} <ArrowRight className="size-4" />
      </Link>
    </div>
  )
}

const tileClass = 'group flex flex-col items-center gap-2 rounded-xl px-0.5 py-1.5 text-center text-[11.5px] leading-tight font-semibold transition hover:text-primary lg:px-1 lg:py-2.5 lg:text-[13px] lg:hover:bg-primary/5'
const tileIconClass = 'flex size-12 items-center justify-center rounded-2xl transition'

function CategoryTile({ category: c }: { category: CategoryNode }) {
  const Icon = categoryIcon(c.name)
  return (
    <Link to={`/products?category=${c.slug}`} className={tileClass}>
      <span className={`${tileIconClass} bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground`}>
        <Icon className="size-5" />
      </span>
      {c.name}
    </Link>
  )
}

/** Phones: the "All parts" tile opens every category as a grid of big icon tiles in a bottom sheet. */
function CategorySheet({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<button type="button" className={tileClass} />}>
        <span className={`${tileIconClass} bg-primary text-primary-foreground`}><LayoutGrid className="size-5" /></span>
        All categories
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
