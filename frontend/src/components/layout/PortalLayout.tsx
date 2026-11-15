import { useQuery } from '@tanstack/react-query'
import { Bell, Menu, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loading } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMe } from '@/hooks/useAuth'
import { get } from '@/lib/api'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { UserMenu } from './UserMenu'

export interface NavItem {
  label: string
  to: string
  icon?: LucideIcon
  children?: { label: string; to: string }[]
  end?: boolean
  soon?: boolean
}

function isActive(location: ReturnType<typeof useLocation>, to: string, end?: boolean) {
  const [path, query] = to.split('?')
  if (query) return location.pathname === path && location.search === `?${query}`
  return end ? location.pathname === path : location.pathname === path || location.pathname.startsWith(path + '/')
}

function NavTree({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const location = useLocation()
  return (
    <nav className="grid gap-0.5 text-sm">
      {items.map((item) => {
        const active = isActive(location, item.to, item.end ?? !item.children)
        const Icon = item.icon
        return (
          <div key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-sidebar-accent hover:text-white',
                active ? 'bg-sidebar-primary font-medium text-white' : 'text-sidebar-foreground',
              )}
            >
              {Icon && <Icon className="size-4 shrink-0" />}
              <span className="flex-1">{item.label}</span>
              {item.soon && <span className="text-[10px] tracking-wide text-white/50 uppercase">Soon</span>}
            </NavLink>
            {item.children && active && (
              <div className="mt-0.5 mb-1 ml-[1.15rem] grid gap-0.5 border-l border-sidebar-border pl-3">
                {item.children.map((c) => (
                  <NavLink
                    key={c.to}
                    to={c.to}
                    onClick={onNavigate}
                    className={cn(
                      'rounded-md px-2 py-1 text-[13px] hover:text-white',
                      isActive(location, c.to, true) ? 'font-medium text-highlight' : 'text-sidebar-foreground/80',
                    )}
                  >
                    {c.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function NotificationBell({ base, dark }: { base: string; dark?: boolean }) {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => get<{ count: number }>('/notifications/unread_count/'),
    refetchInterval: 60_000,
  })
  return (
    <Button variant="ghost" size="icon" className={cn('relative', dark && 'text-white hover:bg-white/10 hover:text-white')} render={<Link to={`${base}/notifications`} aria-label={data?.count ? `Notifications, ${data.count} unread` : 'Notifications'} />}>
      <Bell />
      {!!data?.count && (
        <span className={cn('absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold', dark ? 'bg-highlight text-highlight-foreground' : 'bg-primary text-primary-foreground')}>
          {data.count > 9 ? '9+' : data.count}
        </span>
      )}
    </Button>
  )
}

export function PortalLayout({
  items, base, label, allow, banner,
}: {
  items: NavItem[]
  base: string
  label: string
  allow: (me: Me) => boolean
  banner?: (me: Me) => ReactNode
}) {
  const { data: me, isLoading } = useMe()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  if (isLoading) return <Loading />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!allow(me)) return <Navigate to="/" replace />

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex print:hidden">
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <Logo to={base} suffix={label} size="sm" />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavTree items={items} />
        </div>
        <div className="border-t border-sidebar-border p-3 text-xs">
          <Link to="/" className="text-sidebar-foreground/70 hover:text-white">← Back to shop</Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/95 px-4 backdrop-blur print:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
              <SheetTitle className="flex h-16 items-center border-b border-sidebar-border px-4">
                <Logo to={base} suffix={label} size="sm" />
              </SheetTitle>
              <div className="overflow-y-auto p-3">
                <NavTree items={items} onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <Logo to={base} tile size="sm" className="lg:hidden" />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell base={base} />
            <UserMenu />
          </div>
        </header>
        {banner?.(me)}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
