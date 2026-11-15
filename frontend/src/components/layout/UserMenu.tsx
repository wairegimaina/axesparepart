import { LayoutDashboard, LifeBuoy, LogOut, MapPin, Package, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { homeFor, useLogout, useMe } from '@/hooks/useAuth'
import { useAuthDialog } from '@/hooks/useAuthDialog'
import { cn } from '@/lib/utils'

/** `dark` styles the trigger for the navy header. */
export function UserMenu({ dark }: { dark?: boolean }) {
  const { data: me } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const openAuth = useAuthDialog((s) => s.open)
  if (!me) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className={cn(dark && 'text-white hover:bg-white/10 hover:text-white')} onClick={() => openAuth('login')}>Sign in</Button>
        <Button size="sm" className={cn('hidden sm:inline-flex', dark && 'bg-highlight text-highlight-foreground hover:bg-highlight/90')} onClick={() => openAuth('register')}>Create account</Button>
      </div>
    )
  }
  const portal = homeFor(me)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={cn('gap-2', dark && 'text-white hover:bg-white/10 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white')} />}>
        <UserRound /> <span className="hidden max-w-32 truncate sm:inline">{me.full_name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Base UI requires a label to sit inside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            <span className="block text-sm font-medium text-foreground">{me.full_name}</span>
            {me.email}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {me.role === 'customer' && (
          <>
            <DropdownMenuItem onClick={() => navigate('/account/orders')}><Package /> My orders</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/account/support')}><LifeBuoy /> Help</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/account/addresses')}><MapPin /> Addresses</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/account/settings')}><UserRound /> Account settings</DropdownMenuItem>
          </>
        )}
        {portal !== '/' && (
          <DropdownMenuItem onClick={() => navigate(portal)}>
            <LayoutDashboard /> {me.role === 'admin' ? 'Admin portal' : 'Supplier portal'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={async () => {
            await logout()
            navigate('/')
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
