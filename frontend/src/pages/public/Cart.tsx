import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ShoppingCart, Trash2, Wrench } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState, Loading } from '@/components/common'
import { QuantityInput } from '@/components/QuantityInput'
import { Button } from '@/components/ui/button'
import { useMe } from '@/hooks/useAuth'
import { post } from '@/lib/api'
import { useCart } from '@/lib/cart'
import { CONDITION_LABEL, money } from '@/lib/format'
import type { Quote } from '@/lib/types'

export function useQuote(county = '') {
  const lines = useCart((s) => s.lines)
  return useQuery({
    queryKey: ['quote', lines, county],
    queryFn: () => post<Quote>('/cart/quote/', { items: lines, county }),
    enabled: lines.length > 0,
    placeholderData: (p) => p,
  })
}

/** Parts only. Delivery is agreed on the confirmation call, so the summary never shows a delivery charge. */
export function Totals({ quote }: { quote: Quote }) {
  return (
    <dl className="grid gap-2 text-sm">
      <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(quote.total)}</dd></div>
      {quote.delivery_days && (
        <p className="text-xs text-muted-foreground">Arrives in {quote.delivery_days[0] === quote.delivery_days[1] ? quote.delivery_days[0] : quote.delivery_days.join('–')} working day{quote.delivery_days[1] === 1 ? '' : 's'}</p>
      )}
    </dl>
  )
}

export default function Cart() {
  const { lines, setQuantity, remove } = useCart()
  const { data: me } = useMe()
  const quote = useQuote()
  const navigate = useNavigate()

  if (!lines.length)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState title="Your cart is empty" description="Add parts to see them here." action={<Button render={<Link to="/products" />}>Browse parts</Button>} />
      </div>
    )
  if (!quote.data) return <Loading />
  const q = quote.data
  const sellerAccount = me && me.role !== 'customer'

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Cart</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <ul className="divide-y surface">
          {q.lines.map((ln) => (
            <li key={ln.listing_id} className="flex gap-4 p-4">
              <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {ln.product?.image ? <img src={ln.product.image} alt="" className="h-full w-full object-contain p-1 mix-blend-multiply dark:mix-blend-normal" /> : <Wrench className="size-6 text-muted-foreground/50" />}
              </div>
              <div className="min-w-0 flex-1">
                {ln.product ? (
                  <>
                    <Link to={`/products/${ln.product.slug}`} className="font-medium hover:underline">{ln.product.name}</Link>
                    <p className="text-xs text-muted-foreground">{ln.product.brand}{ln.product.part_number && ` · ${ln.product.part_number}`} · {ln.condition && CONDITION_LABEL[ln.condition]}</p>
                  </>
                ) : (
                  <p className="font-medium text-muted-foreground">Unavailable item</p>
                )}
                {ln.error && <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" /> {ln.error}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {ln.product && (
                    <QuantityInput
                      value={ln.quantity}
                      min={ln.min_order_quantity ?? 1}
                      max={ln.available_quantity ?? undefined}
                      onChange={(n) => setQuantity(ln.listing_id, n)}
                    />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove(ln.listing_id)}><Trash2 /> Remove</Button>
                </div>
              </div>
              <div className="text-right">
                {ln.line_total && !ln.error && <p className="font-semibold tabular-nums">{money(ln.line_total)}</p>}
                {ln.unit_price && ln.quantity > 1 && <p className="text-xs text-muted-foreground">{money(ln.unit_price)} each</p>}
              </div>
            </li>
          ))}
        </ul>
        <aside className="h-fit surface p-5 lg:sticky lg:top-20">
          <h2 className="mb-4 font-semibold">Order summary</h2>
          <Totals quote={q} />
          {sellerAccount ? (
            <p className="mt-4 rounded-lg bg-muted p-3 text-sm">You're signed in with a {me.role} account. Sign in with a customer account to place orders.</p>
          ) : (
            <Button
              size="lg"
              className="mt-5 w-full"
              disabled={q.has_errors}
              onClick={() => navigate(me ? '/checkout' : '/login?next=/checkout')}
            >
              <ShoppingCart /> {me ? 'Checkout' : 'Sign in to check out'}
            </Button>
          )}
          {q.has_errors && <p className="mt-2 text-xs text-destructive">Fix or remove the items marked above to continue.</p>}
        </aside>
      </div>
    </div>
  )
}
