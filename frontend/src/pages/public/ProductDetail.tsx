import { useQuery } from '@tanstack/react-query'
import { Bike, Lock, MessageCircle, PhoneCall, ShieldCheck, ShoppingCart, Tag, Truck } from 'lucide-react'
import { Gallery } from '@/components/Gallery'
import { usePublicConfig } from '@/pages/public/Help'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { QuantityInput } from '@/components/QuantityInput'
import { useCart } from '@/lib/cart'
import { ErrorNote, Loading, Markdown } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { get } from '@/lib/api'
import { AVAILABILITY_LABEL, CONDITION_LABEL, date, money } from '@/lib/format'
import type { Offer, ProductDetail as Detail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { usePageMeta } from '@/hooks/usePageMeta'

function AddToCart({ offer, productName }: { offer: Offer; productName: string }) {
  const add = useCart((s) => s.add)
  const inCart = useCart((s) => s.lines.find((l) => l.listing_id === offer.id)?.quantity ?? 0)
  const navigate = useNavigate()
  const min = offer.min_order_quantity
  const max = offer.availability === 'in_stock' ? Math.max(0, offer.quantity - inCart) : undefined
  const [qty, setQty] = useState(min)
  if (offer.availability === 'out_of_stock' || max === 0) {
    return <Button disabled variant="outline">{inCart ? 'All stock in your cart' : 'Out of stock'}</Button>
  }
  return (
    <div className="flex items-center gap-2">
      <QuantityInput value={qty} onChange={setQty} min={inCart ? 1 : min} max={max} />
      <Button
        onClick={() => {
          add(offer.id, qty)
          toast.success(`Added ${qty} × ${productName}`, { action: { label: 'View cart', onClick: () => navigate('/cart') } })
          setQty(min)
        }}
      >
        <ShoppingCart /> Add to cart
      </Button>
    </div>
  )
}

/** schema.org Product data, so Google can show the price and availability in search results. */
function productSchema(p: Detail) {
  const prices = p.offers.map((o) => Number(o.price))
  const image = [...p.images, ...p.offers.flatMap((o) => o.images)].map((i) => i.url)
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: p.part_number || undefined,
    mpn: p.part_number || undefined,
    brand: { '@type': 'Brand', name: p.brand.name },
    category: p.category.name,
    description: p.description || undefined,
    image: image.length ? image : undefined,
    offers: prices.length ? {
      '@type': 'AggregateOffer',
      priceCurrency: 'KES',
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: prices.length,
      availability: p.offers.some((o) => o.in_stock) ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
    } : undefined,
  }
}

export default function ProductDetail() {
  const { slug } = useParams()
  const { data: p, isLoading, error } = useQuery({ queryKey: ['product', slug], queryFn: () => get<Detail>(`/products/${slug}/`) })
  usePageMeta(
    p ? [p.name, p.brand.name, p.part_number].filter(Boolean).join(' · ') : undefined,
    p ? `${p.name} by ${p.brand.name}${p.part_number ? ` (part no. ${p.part_number})` : ''}. ${p.description || `Buy ${p.category.name.toLowerCase()} online from Axe Spare Parts, delivered across Kenya.`}` : undefined,
    p ? productSchema(p) : undefined,
  )

  if (isLoading) return <Loading />
  if (error || !p)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorNote error={error ?? 'Product not found'} />
      </div>
    )

  const images = [...p.images, ...p.offers.flatMap((o) => o.images)]
  const compat = p.compatibility.split('\n').map((s) => s.trim()).filter(Boolean)
  const best = p.offers.map((o) => o.deal).filter((d) => d !== null).sort((a, b) => b.percent - a.percent)[0]

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-4 flex flex-wrap gap-1 text-xs text-muted-foreground">
        <Link to="/products" className="hover:text-foreground">Parts</Link>
        {p.breadcrumbs.map((b) => (
          <span key={b.slug}>
            {' / '}
            <Link to={`/products?category=${b.slug}`} className="hover:text-foreground">{b.name}</Link>
          </span>
        ))}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_300px]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Gallery images={images} name={p.name} brand={p.brand.name} type={p.category.name}
            badge={best && <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white shadow">−{best.percent}%</span>} />
        </div>

        <div className="min-w-0">
          {best && (
            <div className="relative mb-5 flex items-center gap-3 overflow-hidden rounded-2xl bg-[linear-gradient(110deg,#9f1239,#e11d48_60%,#fb7185)] py-2.5 pr-4 pl-3 text-white">
              <span className="pointer-events-none absolute top-[-60%] right-[14%] h-[220%] w-3 rotate-[24deg] bg-highlight/80" aria-hidden />
              <span className="relative flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 font-heading text-lg leading-none font-bold text-red-700 uppercase italic"><Tag className="size-4" /> Offer</span>
              <span className="relative min-w-0 text-sm">
                <b>{best.percent}% off</b>{best.title && ` · ${best.title}`}
                {best.ends_at && <span className="text-white/80"> · ends {date(best.ends_at)}</span>}
              </span>
            </div>
          )}
          <Link to={`/products?brand=${p.brand.slug}`} className="text-sm font-semibold tracking-wide text-primary uppercase hover:underline">{p.brand.name}</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{p.name}</h1>
          {p.part_number && <p className="mt-2 font-mono text-sm text-muted-foreground">Part no. {p.part_number}</p>}
          {compat.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><Bike className="size-4" /> Fits</span>
              {compat.slice(0, 4).map((c) => <span key={c} className="rounded-full bg-secondary px-2.5 py-0.5 font-medium text-secondary-foreground">{c}</span>)}
              {compat.length > 4 && <a href="#fits" className="text-primary hover:underline">+{compat.length - 4} more</a>}
            </div>
          )}

          <h2 className="mt-8 mb-3 text-sm font-semibold">
            {p.offers.length === 1 ? 'Buy' : 'Choose an option'}
          </h2>
          <div className="grid gap-3">
            {p.offers.map((o) => (
              <div key={o.id} className={cn('surface p-4', o.deal && 'ring-2 ring-red-500/40')}>
                {o.deal && (
                  <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">−{o.deal.percent}% offer</span>
                    {o.deal.title && <span className="font-semibold">{o.deal.title}</span>}
                    {o.deal.ends_at && <span className="text-muted-foreground">Ends {date(o.deal.ends_at)}</span>}
                  </p>
                )}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn('figure text-3xl leading-none text-primary', o.deal && 'text-red-600 dark:text-red-400')}>
                      {money(o.price)}
                      {o.deal && <s className="ml-2 align-middle font-sans text-base font-normal text-muted-foreground">{money(o.deal.was_price)}</s>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{CONDITION_LABEL[o.condition]}</Badge>
                      <Badge variant="outline" className={o.in_stock ? 'text-emerald-700 dark:text-emerald-400' : ''}>
                        {o.in_stock ? `${o.quantity} in stock` : AVAILABILITY_LABEL[o.availability]}
                      </Badge>
                      {o.warranty && <Badge variant="outline"><ShieldCheck /> {o.warranty} warranty</Badge>}
                    </div>
                  </div>
                  <AddToCart offer={o} productName={p.name} />
                </div>
                {(o.min_order_quantity > 1 || o.notes) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {o.min_order_quantity > 1 && <>Minimum order: {o.min_order_quantity}. </>}
                    {o.availability === 'on_request' && <>Sourced on request; we'll confirm the delivery time when we call. </>}
                    {o.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <BuyingPanel />
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-2xl">Description</h2>
          {p.description ? <Markdown>{p.description}</Markdown> : <p className="text-sm text-muted-foreground">No description yet.</p>}
          {compat.length > 0 && (
            <>
              <h2 id="fits" className="mt-8 mb-3 scroll-mt-24 text-2xl">Fits these bikes</h2>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {compat.map((c) => <li key={c} className="rounded-md bg-muted px-3 py-1.5">{c}</li>)}
              </ul>
            </>
          )}
        </section>
        {p.specifications.length > 0 && (
          <section>
            <h2 className="mb-3 text-2xl">Specifications</h2>
            <dl className="divide-y rounded-xl border text-sm">
              {p.specifications.map((s) => (
                <div key={s.name} className="grid grid-cols-2 gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">{s.name}</dt>
                  <dd className="font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  )
}

/** How buying works here, beside the buy box (below it on smaller screens). */
function BuyingPanel() {
  const support = usePublicConfig().data?.support
  const wa = support?.whatsapp.replace(/\D/g, '')
  const rows = [
    { icon: PhoneCall, title: 'We call to confirm', text: "After you order, we call you to confirm the parts, the delivery fee, the address and how you'll pay." },
    { icon: Truck, title: 'Delivery countrywide', text: 'The delivery fee depends on where you are. We agree it with you on the call.' },
    { icon: Lock, title: 'Nothing to pay online', text: 'Nothing is charged when you order. We agree payment with you on the call.' },
    { icon: ShieldCheck, title: 'Genuine parts', text: 'Every part is checked before it is listed.' },
  ]
  return (
    <aside className="surface h-fit p-5 lg:col-span-2 2xl:sticky 2xl:top-24 2xl:col-span-1">
      <h2 className="mb-4 text-xl">Buying with AXE</h2>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-1">
        {rows.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-[18px]" /></span>
            <span className="text-sm"><b className="block">{title}</b><span className="text-muted-foreground">{text}</span></span>
          </li>
        ))}
      </ul>
      {(wa || support?.phone) && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4 2xl:grid">
          <p className="mr-auto text-sm font-medium 2xl:mr-0">Not sure it fits your bike?</p>
          {wa && <Button variant="outline" className="2xl:w-full" render={<a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" />}><MessageCircle /> Ask on WhatsApp</Button>}
          {support?.phone && <Button variant="ghost" className="2xl:w-full" render={<a href={`tel:${support.phone}`} />}><PhoneCall /> Call {support.phone}</Button>}
        </div>
      )}
    </aside>
  )
}
