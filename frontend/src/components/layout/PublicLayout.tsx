import { Search, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMe } from '@/hooks/useAuth'
import { useAuthDialog } from '@/hooks/useAuthDialog'
import { useCartCount } from '@/lib/cart'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { NotificationBell } from './PortalLayout'
import { UserMenu } from './UserMenu'

export function SearchBox({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const navigate = useNavigate()
  return (
    <form
      role="search"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault()
        navigate(`/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search parts, part number or bike model"
        className="bg-white pl-8 text-foreground"
        aria-label="Search spare parts"
      />
    </form>
  )
}

const nav = ({ isActive }: { isActive: boolean }) =>
  cn('text-sm transition hover:text-white', isActive ? 'font-medium text-white' : 'text-white/70')

function CartButton() {
  const count = useCartCount()
  return (
    <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/10 hover:text-white" render={<Link to="/cart" aria-label={`Cart, ${count} items`} />}>
      <ShoppingCart />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-[10px] font-semibold text-highlight-foreground">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Button>
  )
}

export function PublicLayout() {
  // The home page has its own big search box, so skip the header's mobile one there.
  const onHome = useLocation().pathname === '/'
  const { data: me } = useMe()
  const openAuth = useAuthDialog((st) => st.open)
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 bg-brand text-brand-foreground print:hidden">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav className="ml-2 hidden items-center gap-5 md:flex">
            <NavLink to="/products" className={nav}>Parts</NavLink>
            <NavLink to="/brands" className={nav}>Brands</NavLink>
            <NavLink to="/help" className={nav}>Help</NavLink>
          </nav>
          <SearchBox className="ml-auto hidden w-full max-w-md lg:block" />
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            {me?.role === 'customer' && <NotificationBell base="/account" dark />}
            <CartButton />
            <UserMenu dark />
          </div>
        </div>
        {!onHome && (
          <div className="px-4 pb-3 lg:hidden">
            <SearchBox />
          </div>
        )}
        <div className="h-1 bg-gradient-to-r from-primary via-primary to-highlight" />
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-brand text-brand-foreground print:hidden">
        <div className="mx-auto grid max-w-screen-2xl gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6 lg:px-8">
          <div>
            <Logo size="lg" />
            <p className="mt-3 max-w-xs text-white/70">Genuine motorbike spare parts, delivered countrywide.</p>
          </div>
          <div className="grid content-start gap-2">
            <p className="font-medium text-highlight">Shop</p>
            <Link to="/products" className="text-white/70 hover:text-white">All parts</Link>
            <Link to="/brands" className="text-white/70 hover:text-white">Brands</Link>
            <Link to="/account/orders" className="text-white/70 hover:text-white">Track my order</Link>
            <Link to="/help" className="text-white/70 hover:text-white">Help & contact</Link>
          </div>
          <div className="grid content-start gap-2">
            <p className="font-medium text-highlight">Account</p>
            <button type="button" onClick={() => openAuth('login')} className="text-left text-white/70 hover:text-white">Sign in</button>
            <button type="button" onClick={() => openAuth('register')} className="text-left text-white/70 hover:text-white">Create account</button>
          </div>
        </div>
        <p className="border-t border-white/10 py-4 text-center text-xs text-white/60">© {new Date().getFullYear()} Axe Genuine Spare Parts</p>
      </footer>
    </div>
  )
}
