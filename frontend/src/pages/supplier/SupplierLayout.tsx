import {
  BarChart3, Banknote, Bell, Boxes, Building2, ClipboardList, LayoutDashboard, LifeBuoy, Package, Settings, Star, Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { PortalLayout, type NavItem } from '@/components/layout/PortalLayout'
import type { Me } from '@/lib/types'

const items: NavItem[] = [
  { label: 'Dashboard', to: '/supplier', icon: LayoutDashboard, end: true },
  {
    label: 'Company Profile', to: '/supplier/profile', icon: Building2,
    children: [
      { label: 'Company Information', to: '/supplier/profile?tab=info' },
      { label: 'About Us', to: '/supplier/profile?tab=about' },
      { label: 'Logo & Cover Image', to: '/supplier/profile?tab=images' },
      { label: 'What You Sell', to: '/supplier/profile?tab=categories' },
      { label: 'Verification Documents', to: '/supplier/profile?tab=documents' },
    ],
  },
  {
    label: 'Product Management', to: '/supplier/products', icon: Package,
    children: [
      { label: 'All Products', to: '/supplier/products' },
      { label: 'Add Product', to: '/supplier/products/new' },
      { label: 'Pending Approval', to: '/supplier/products?status=pending' },
      { label: 'Published Products', to: '/supplier/products?status=approved' },
      { label: 'Rejected Products', to: '/supplier/products?status=rejected' },
      { label: 'Bulk Import', to: '/supplier/products/import' },
    ],
  },
  {
    label: 'Inventory', to: '/supplier/inventory', icon: Boxes,
    children: [
      { label: 'Stock Management', to: '/supplier/inventory' },
      { label: 'Low Stock', to: '/supplier/inventory?tab=low' },
      { label: 'Stock Updates', to: '/supplier/inventory?tab=movements' },
    ],
  },
  {
    label: 'Orders', to: '/supplier/orders', icon: ClipboardList,
    children: [
      { label: 'Incoming Orders', to: '/supplier/orders?status=incoming' },
      { label: 'Accepted Orders', to: '/supplier/orders?status=accepted' },
      { label: 'Processing', to: '/supplier/orders?status=processing' },
      { label: 'Completed Orders', to: '/supplier/orders?status=completed' },
    ],
  },
  { label: 'Analytics', to: '/supplier/analytics', icon: BarChart3 },
  { label: 'Earnings', to: '/supplier/statement', icon: Banknote },
  { label: 'Reviews', to: '/supplier/reviews', icon: Star, soon: true },
  { label: 'Team', to: '/supplier/team', icon: Users },
  { label: 'Help', to: '/supplier/support', icon: LifeBuoy },
  { label: 'Notifications', to: '/supplier/notifications', icon: Bell },
  { label: 'Account Settings', to: '/supplier/account', icon: Settings },
]

function StatusBanner(me: Me) {
  const s = me.supplier
  if (!s || s.status === 'approved') return null
  const text = {
    pending: 'Your company is under review. Upload your registration and KRA documents.',
    rejected: 'Your application was not approved. See the reason on your dashboard.',
    suspended: 'Your account is suspended. Your products are hidden from the marketplace.',
  }[s.status]
  const tone = s.status === 'pending' ? 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200'
  return (
    <div className={`border-b px-4 py-2.5 text-sm lg:px-8 ${tone}`}>
      {text}{' '}
      {s.status === 'pending' && <Link to="/supplier/profile?tab=documents" className="font-medium underline">Upload documents</Link>}
    </div>
  )
}

export default function SupplierLayout() {
  return <PortalLayout items={items} base="/supplier" label="Supplier" allow={(me) => !!me.supplier} banner={StatusBanner} />
}

export const canEditProducts = (me: Me | null | undefined) =>
  !!me?.supplier && ['owner', 'manager', 'inventory'].includes(me.supplier.member_role)
export const canEditProfile = (me: Me | null | undefined) =>
  !!me?.supplier && ['owner', 'manager'].includes(me.supplier.member_role)
