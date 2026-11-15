import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, PhoneCall } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ErrorNote, Field, Loading } from '@/components/common'
import { AddressFields, emptyAddress, type AddressDraft } from '@/components/AddressForm'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/hooks/useAuth'
import { ApiError, get, post } from '@/lib/api'
import { useCart } from '@/lib/cart'
import { money } from '@/lib/format'
import type { Address, CheckoutOptions, CustomerOrder } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Totals, useQuote } from './Cart'

export default function Checkout() {
  const { data: me, isLoading: meLoading } = useMe()
  const { lines, clear } = useCart()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isCustomer = me?.role === 'customer'
  const options = useQuery({ queryKey: ['checkout-options'], queryFn: () => get<CheckoutOptions>('/checkout/options/') })
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => get<Address[]>('/account/addresses/'), enabled: isCustomer })

  const [addressId, setAddressId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<AddressDraft>(emptyAddress)
  // Quote against the address being used, so we know whether we deliver there.
  const county = addressId === 'new' ? draft.county : addresses.data?.find((a) => a.id === addressId)?.county ?? ''
  const quote = useQuote(county)
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const placed = useRef<string | null>(null)

  useEffect(() => {
    if (addresses.data && addressId === null) {
      const def = addresses.data.find((a) => a.is_default) ?? addresses.data[0]
      setAddressId(def ? def.id : 'new')
      if (!def && me) setDraft((d) => ({ ...d, recipient_name: me.full_name, phone: me.phone }))
    }
  }, [addresses.data, addressId, me])

  if (meLoading) return <Loading />
  if (!me) return <Navigate to="/login?next=/checkout" replace />
  if (!isCustomer) return <Navigate to="/cart" replace />
  // After a successful order the cart empties; go to the order, not back to the empty cart.
  if (placed.current) return <Navigate to={`/account/orders/${placed.current}?placed=1`} replace />
  if (!lines.length) return <Navigate to="/cart" replace />
  if (!quote.data || !options.data || !addresses.data) return <Loading />
  const q = quote.data

  const place = async () => {
    setError('')
    setAddressErrors({})
    setBusy(true)
    try {
      const body = {
        items: lines, notes, expected_total: q.total,
        ...(addressId === 'new' ? { address: draft, save_address: true } : { address_id: addressId }),
      }
      const order = await post<CustomerOrder>('/account/orders/', body)
      placed.current = order.number
      qc.invalidateQueries({ queryKey: ['addresses'] })
      qc.invalidateQueries({ queryKey: ['customer-orders'] })
      navigate(`/account/orders/${order.number}?placed=1`, { replace: true })
      clear()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await quote.refetch()
        setError('Prices or stock changed while you were checking out. Review the updated total and place the order again.')
      } else if (e instanceof ApiError) {
        setAddressErrors(e.nested('address'))
        const itemErrors = (e.raw as { item_errors?: Record<string, string> } | null)?.item_errors
        if (itemErrors) {
          await quote.refetch()
          setError('Some items changed. Go back to your cart to fix them.')
        } else setError(Object.keys(e.nested('address')).length ? 'Check the delivery address.' : e.message)
      } else setError((e as Error).message)
      toast.error('Order not placed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Checkout</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-6">
          <section className="surface p-5">
            <h2 className="mb-4 font-semibold">1. Delivery address</h2>
            <div className="grid gap-2">
              {addresses.data.map((a) => (
                <label key={a.id} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 text-sm', addressId === a.id && 'border-primary ring-1 ring-primary')}>
                  <input type="radio" name="address" className="mt-1 accent-primary" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                  <span>
                    <span className="font-medium">{a.label || a.recipient_name}</span>
                    <span className="block text-muted-foreground">{a.recipient_name} · {a.phone}</span>
                    <span className="block text-muted-foreground">{a.street_address}, {a.town}, {a.county}</span>
                  </span>
                </label>
              ))}
              {addresses.data.length > 0 && (
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm', addressId === 'new' && 'border-primary ring-1 ring-primary')}>
                  <input type="radio" name="address" className="accent-primary" checked={addressId === 'new'} onChange={() => setAddressId('new')} />
                  Deliver somewhere else
                </label>
              )}
            </div>
            {addressId === 'new' && <div className="mt-4"><AddressFields value={draft} onChange={setDraft} errors={addressErrors} /></div>}
          </section>

          <section className="surface p-5">
            <h2 className="mb-2 font-semibold">2. Payment</h2>
            <p className="flex gap-2 text-sm text-muted-foreground">
              <PhoneCall className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>Nothing is charged now. After you order, we call you to confirm the parts and the delivery fee, and agree with you how you'll pay.</span>
            </p>
          </section>

          <section className="surface p-5">
            <h2 className="mb-4 font-semibold">3. Anything we should know?</h2>
            <Field label="Order notes (optional)" htmlFor="notes" hint="e.g. bike model or number plate">
              <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </section>
        </div>

        <aside className="h-fit surface p-5 lg:sticky lg:top-20">
          <h2 className="mb-3 font-semibold">Your order</h2>
          <ul className="mb-4 grid gap-2 text-sm">
            {q.lines.map((ln) => (
              <li key={ln.listing_id} className="flex justify-between gap-3">
                <span className="min-w-0"><span className="text-muted-foreground">{ln.quantity} ×</span> {ln.product?.name ?? 'Unavailable'}
                  {ln.error && <span className="block text-xs text-destructive">{ln.error}</span>}</span>
                <span className="shrink-0 tabular-nums">{ln.line_total && !ln.error ? money(ln.line_total) : '—'}</span>
              </li>
            ))}
          </ul>
          <Totals quote={q} />
          {error && <div className="mt-4"><ErrorNote error={error} /></div>}
          {!q.delivery_available && <div className="mt-4"><ErrorNote error={`Sorry, we don't deliver to ${q.county} yet.`} /></div>}
          <Button size="lg" className="mt-5 w-full" disabled={busy || q.has_errors || !q.delivery_available || !county} onClick={place}>
            {busy ? 'Placing order…' : `Place order · ${money(q.total)}`}
          </Button>
          {q.has_errors && <Link to="/cart" className="mt-2 block text-center text-sm text-destructive underline">Fix items in your cart</Link>}
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 size-3 shrink-0" /> Nothing is charged now. We'll call to confirm your order.</p>
        </aside>
      </div>
    </div>
  )
}
