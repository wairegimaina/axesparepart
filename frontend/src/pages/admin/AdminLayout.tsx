import { BarChart3, Bell, Building2, UserCog, ClipboardCheck, FolderTree, History, LayoutDashboard, LifeBuoy, Settings, ShoppingBag, SlidersHorizontal, Truck, Users, Wallet } from 'lucide-react'
import { PortalLayout, type NavItem } from '@/components/layout/PortalLayout'
import { Navigate, useLocation } from 'react-router-dom'
import { useMe } from '@/hooks/useAuth'

const items: NavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: LayoutDashboard, end: true },
  {
    label: 'Orders', to: '/admin/orders', icon: ShoppingBag,
    children: [
      { label: 'To verify', to: '/admin/orders' },
      { label: 'In fulfilment', to: '/admin/orders?status=confirmed' },
      { label: 'Delivered', to: '/admin/orders?status=delivered' },
      { label: 'All orders', to: '/admin/orders?status=' },
    ],
  },
  { label: 'Deliveries', to: '/admin/deliveries', icon: Truck },
  { label: 'Payments', to: '/admin/payments', icon: Wallet },
  { label: 'Reports', to: '/admin/reports', icon: BarChart3 },
  { label: 'Help requests', to: '/admin/support', icon: LifeBuoy },
  { label: 'Customers', to: '/admin/customers', icon: Users },
  {
    label: 'Suppliers', to: '/admin/suppliers', icon: Building2,
    children: [
      { label: 'All suppliers', to: '/admin/suppliers' },
      { label: 'Active', to: '/admin/suppliers?status=approved' },
      { label: 'Suspended', to: '/admin/suppliers?status=suspended' },
    ],
  },
  {
    label: 'Product approvals', to: '/admin/listings', icon: ClipboardCheck,
    children: [
      { label: 'Pending', to: '/admin/listings' },
      { label: 'Offers', to: '/admin/listings?status=offers' },
      { label: 'Published', to: '/admin/listings?status=approved' },
      { label: 'Rejected', to: '/admin/listings?status=rejected' },
    ],
  },
  { label: 'Catalogue', to: '/admin/catalogue', icon: FolderTree },
  { label: 'Team', to: '/admin/team', icon: UserCog },
  { label: 'Settings', to: '/admin/settings', icon: SlidersHorizontal },
  { label: 'Audit log', to: '/admin/audit', icon: History },
  { label: 'Notifications', to: '/admin/notifications', icon: Bell },
  { label: 'Account settings', to: '/admin/account', icon: Settings },
]

/** What orders staff (callers) can open. The backend enforces the same list. */
const STAFF_PAGES = ['/admin', '/admin/orders', '/admin/deliveries', '/admin/payments', '/admin/support', '/admin/customers',
  '/admin/notifications', '/admin/account']

export default function AdminLayout() {
  const { data: me } = useMe()
  const { pathname } = useLocation()
  const staff = me?.role === 'admin' && me.admin_scope === 'orders'
  if (staff && !isStaffPath(pathname)) return <Navigate to="/admin" replace />
  return (
    <PortalLayout
      items={staff ? items.filter((i) => STAFF_PAGES.includes(i.to)) : items}
      base="/admin"
      label={staff ? 'Staff' : 'Admin'}
      allow={(m) => m.role === 'admin'}
    />
  )
}

function isStaffPath(path: string) {
  return STAFF_PAGES.some((p) => (p === '/admin' ? path === '/admin' || path === '/admin/' : path === p || path.startsWith(p + '/')))
}
