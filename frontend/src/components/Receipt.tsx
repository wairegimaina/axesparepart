import { date, money } from '@/lib/format'
import type { CustomerOrder } from '@/lib/types'

/** Print-only receipt (paid) or invoice (not yet paid) for a customer order. */
export function Receipt({ order: o }: { order: CustomerOrder }) {
  const paid = o.payment_status === 'paid'
  const items = o.items.filter((i) => i.status === 'active')
  return (
    <div className="hidden text-sm text-black print:block">
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <p className="text-2xl font-bold tracking-tight">AXE</p>
          <p className="text-xs font-semibold tracking-widest uppercase">Genuine Spare Parts</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold">{paid ? 'Receipt' : 'Invoice'}</p>
          <p className="font-mono">{o.number}</p>
          <p>Date: {date(o.created_at)}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className="font-semibold">Deliver to</p>
          <p>{o.recipient_name}</p>
          <p>{o.phone}</p>
          <p>{o.street_address}, {o.town}, {o.county}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold">Payment</p>
          <p>{o.payment_status_display}</p>
        </div>
      </div>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1.5">Item</th><th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Unit price</th><th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-gray-300">
              <td className="py-1.5">{i.product_name}<span className="block text-xs">{i.brand_name}{i.part_number && ` · ${i.part_number}`}</span></td>
              <td className="py-1.5 text-right">{i.quantity}</td>
              <td className="py-1.5 text-right">{money(i.unit_price)}</td>
              <td className="py-1.5 text-right">{money(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 ml-auto grid w-64 gap-1">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
        <div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.delivery_fee)}</dd></div>
        <div className="flex justify-between border-t border-black pt-1 font-semibold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
        <div className="flex justify-between"><dt>Paid</dt><dd>{money(o.amount_paid)}</dd></div>
        {Number(o.amount_refunded) > 0 && <div className="flex justify-between"><dt>Refunded</dt><dd>{money(o.amount_refunded)}</dd></div>}
        <div className="flex justify-between font-semibold"><dt>Balance</dt><dd>{money(o.balance_due)}</dd></div>
      </dl>
      <p className="mt-10 text-center text-xs">Thank you for shopping with Axe Genuine Spare Parts.</p>
    </div>
  )
}
