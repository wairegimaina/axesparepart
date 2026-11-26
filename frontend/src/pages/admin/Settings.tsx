import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Field, Loading, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { get, patch } from '@/lib/api'
import { applyApiErrors } from '@/lib/forms'
import { dateTime } from '@/lib/format'
import { DeliveryRates } from './DeliveryRates'
import { PricingRules } from './PricingRules'

interface MarketSettings {
  default_markup_percent: string
  share_min_markup_percent: string
  default_low_stock_threshold: number
  currency: string
  delivery_fee: string
  free_delivery_threshold: string
  support_phone: string
  support_whatsapp: string
  support_email: string
  support_hours: string
  google_client_id: string
  updated_at: string
}

type FormValues = Omit<MarketSettings, 'currency' | 'updated_at' | 'default_low_stock_threshold'> & { default_low_stock_threshold: string }

export default function Settings() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => get<MarketSettings>('/admin/settings/') })
  const form = useForm<FormValues>({
    values: q.data ? {
      default_markup_percent: q.data.default_markup_percent, share_min_markup_percent: q.data.share_min_markup_percent, default_low_stock_threshold: String(q.data.default_low_stock_threshold),
      delivery_fee: q.data.delivery_fee, free_delivery_threshold: q.data.free_delivery_threshold,
      support_phone: q.data.support_phone, support_whatsapp: q.data.support_whatsapp,
      support_email: q.data.support_email, support_hours: q.data.support_hours,
      google_client_id: q.data.google_client_id,
    } : undefined,
  })
  if (!q.data) return <Loading />
  const markup = Number(form.watch('default_markup_percent') || 0)
  const e = form.formState.errors
  return (
    <>
      <PageHeader title="Settings" description={`Last changed ${dateTime(q.data.updated_at)}`} />
      <form
        className="grid max-w-2xl gap-6"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            const saved = await patch<MarketSettings>('/admin/settings/', { ...v, default_low_stock_threshold: Number(v.default_low_stock_threshold) })
            qc.setQueryData(['admin', 'settings'], saved)
            qc.invalidateQueries({ queryKey: ['checkout-options'] })
            qc.invalidateQueries({ queryKey: ['config'] })
            toast.success('Settings saved')
          } catch (err) {
            toast.error(applyApiErrors(err, form.setError) || 'Check the form')
          }
        })}
      >
        <section className="grid gap-5 surface p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Pricing & stock</h2>
          <Field label="Default markup (%)" htmlFor="markup" error={e.default_markup_percent?.message}
            hint={`A KES 1,000 part sells for KES ${Math.round(1000 * (1 + markup / 100)).toLocaleString()}. Categories can set their own below.`}>
            <Input id="markup" type="number" step="0.01" min="0" {...form.register('default_markup_percent')} />
          </Field>
          <Field label="Supplier share only from markup of (%)" htmlFor="share-min" error={e.share_min_markup_percent?.message}
            hint={`On parts with a lower markup, suppliers get no share and Axe keeps it all. 0 = always share.`}>
            <Input id="share-min" type="number" step="0.5" min="0" {...form.register('share_min_markup_percent')} />
          </Field>
          <Field label="Default low-stock alert" htmlFor="low" error={e.default_low_stock_threshold?.message} >
            <Input id="low" type="number" min="0" {...form.register('default_low_stock_threshold')} />
          </Field>
        </section>
        <section className="grid gap-5 surface p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Delivery</h2>
          <Field label="Standard delivery fee (KES)" htmlFor="fee" error={e.delivery_fee?.message} >
            <Input id="fee" type="number" min="0" {...form.register('delivery_fee')} />
          </Field>
          <Field label="Free delivery from (KES)" htmlFor="free" error={e.free_delivery_threshold?.message} hint="0 = off">
            <Input id="free" type="number" min="0" {...form.register('free_delivery_threshold')} />
          </Field>
        </section>
        <section className="grid gap-5 surface p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Customer support</h2>
          <Field label="Phone" htmlFor="s-phone" error={e.support_phone?.message}><Input id="s-phone" type="tel" placeholder="+254…" {...form.register('support_phone')} /></Field>
          <Field label="WhatsApp" htmlFor="s-wa" error={e.support_whatsapp?.message} hint="e.g. 254712345678"><Input id="s-wa" {...form.register('support_whatsapp')} /></Field>
          <Field label="Email" htmlFor="s-email" error={e.support_email?.message}><Input id="s-email" type="email" {...form.register('support_email')} /></Field>
          <Field label="Hours" htmlFor="s-hours" error={e.support_hours?.message}><Input id="s-hours" placeholder="Mon–Sat 8am–6pm" {...form.register('support_hours')} /></Field>
        </section>
        <section className="grid gap-5 surface p-5">
          <h2 className="font-semibold">Sign in with Google</h2>
          <Field
            label="Google client ID" htmlFor="g-client" error={e.google_client_id?.message}
            hint="From Google Cloud Console → Credentials → OAuth client ID (Web). Add this site's address under Authorised JavaScript origins. Leave empty to hide the Google button."
          >
            <Input id="g-client" placeholder="1234…apps.googleusercontent.com" {...form.register('google_client_id')} />
          </Field>
        </section>
        <div><Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>Save settings</Button></div>
      </form>
      <div className="mt-6"><PricingRules defaultMarkup={q.data.default_markup_percent} shareMin={q.data.share_min_markup_percent} /></div>
      <div className="mt-6"><DeliveryRates standardFee={q.data.delivery_fee} /></div>
    </>
  )
}
