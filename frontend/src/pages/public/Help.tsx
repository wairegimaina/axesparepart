import { useQuery } from '@tanstack/react-query'
import { Clock, LifeBuoy, Mail, MessageCircle, Phone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useMe } from '@/hooks/useAuth'
import { useAuthDialog } from '@/hooks/useAuthDialog'
import { get } from '@/lib/api'
import type { PublicConfig } from '@/lib/types'

export function usePublicConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => get<PublicConfig>('/config/'), staleTime: 10 * 60_000 })
}

export default function Help() {
  const { data: me } = useMe()
  const openAuth = useAuthDialog((s) => s.open)
  const s = usePublicConfig().data?.support
  const ticketsPath = me?.role === 'supplier' ? '/supplier/support/new' : '/account/support/new'
  const rows = [
    s?.phone && { icon: Phone, label: 'Call us', value: s.phone, href: `tel:${s.phone}` },
    s?.whatsapp && { icon: MessageCircle, label: 'WhatsApp', value: `+${s.whatsapp.replace(/^\+/, '')}`, href: `https://wa.me/${s.whatsapp.replace(/\D/g, '')}` },
    s?.email && { icon: Mail, label: 'Email', value: s.email, href: `mailto:${s.email}` },
    s?.hours && { icon: Clock, label: 'Hours', value: s.hours },
  ].filter(Boolean) as { icon: typeof Phone; label: string; value: string; href?: string }[]

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Help & contact</h1>
      <p className="mt-2 text-muted-foreground">We're here to help with orders, deliveries, payments and your account.</p>
      {rows.length > 0 && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {rows.map(({ icon: Icon, label, value, href }) => (
            <div key={label} className="flex items-center gap-3 surface p-4">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                {href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="font-medium break-all hover:underline">{value}</a> : <p className="font-medium">{value}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-brand p-6 text-brand-foreground">
        <div>
          <p className="text-lg font-semibold">Send us a message</p>
          <p className="text-sm text-white/75">Track the reply in your account.</p>
        </div>
        <Button className="bg-highlight text-highlight-foreground hover:bg-highlight/90" {...(me ? { render: <Link to={me.role === 'admin' ? '/admin/support' : ticketsPath} /> } : { onClick: () => openAuth('login', '/account/support/new') })}>
          <LifeBuoy /> {me ? 'New help request' : 'Sign in to send a message'}
        </Button>
      </div>
    </div>
  )
}
