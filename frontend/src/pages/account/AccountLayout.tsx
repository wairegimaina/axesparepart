import { Bell, LifeBuoy, MapPin, Package, Settings } from 'lucide-react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Loading } from '@/components/common'
import { useMe } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

const links = [
  { to: '/account/orders', label: 'Orders', icon: Package },
  { to: '/account/support', label: 'Help', icon: LifeBuoy },
  { to: '/account/notifications', label: 'Notifications', icon: Bell },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin },
  { to: '/account/settings', label: 'Account settings', icon: Settings },
]

export default function AccountLayout() {
  const { data: me, isLoading } = useMe()
  const location = useLocation()
  if (isLoading) return <Loading />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  if (me.role !== 'customer') return <Navigate to={me.role === 'admin' ? '/admin' : '/supplier'} replace />
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-[200px_1fr] print:block print:p-0">
      <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:flex-col print:hidden" aria-label="Account">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn('flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted', isActive ? 'bg-muted font-medium' : 'text-muted-foreground')}>
            <Icon className="size-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0"><Outlet /></div>
    </div>
  )
}
