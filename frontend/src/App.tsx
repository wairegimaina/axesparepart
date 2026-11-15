import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration, useSearchParams } from 'react-router-dom'
import { AuthDialog } from '@/components/AuthDialog'
import { Loading } from '@/components/common'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { homeFor, useMe } from '@/hooks/useAuth'
import { ForgotPassword, Login, NotFound, Register, ResetPassword } from '@/pages/public/Auth'
import Home from '@/pages/public/Home'
import ProductDetail from '@/pages/public/ProductDetail'
import Products from '@/pages/public/Products'
import Brands from '@/pages/public/Brands'
import ComingSoon from '@/pages/shared/ComingSoon'
import Cart from '@/pages/public/Cart'
import Checkout from '@/pages/public/Checkout'
import Help from '@/pages/public/Help'

// Portals load on demand so shoppers don't download them.
const SupplierLayout = lazy(() => import('@/pages/supplier/SupplierLayout'))
const SupplierDashboard = lazy(() => import('@/pages/supplier/Dashboard'))
const SupplierProfile = lazy(() => import('@/pages/supplier/Profile'))
const SupplierProducts = lazy(() => import('@/pages/supplier/Products'))
const SupplierProductForm = lazy(() => import('@/pages/supplier/ProductForm'))
const SupplierImport = lazy(() => import('@/pages/supplier/Import'))
const SupplierInventory = lazy(() => import('@/pages/supplier/Inventory'))
const SupplierTeam = lazy(() => import('@/pages/supplier/Team'))
const SupplierAnalytics = lazy(() => import('@/pages/supplier/Analytics'))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'))
const AdminSuppliers = lazy(() => import('@/pages/admin/Suppliers'))
const AdminSupplierDetail = lazy(() => import('@/pages/admin/SupplierDetail'))
const AdminListings = lazy(() => import('@/pages/admin/Listings'))
const AdminListingReview = lazy(() => import('@/pages/admin/ListingReview'))
const AdminCatalogue = lazy(() => import('@/pages/admin/Catalogue'))
const AdminSettings = lazy(() => import('@/pages/admin/Settings'))
const AdminTeam = lazy(() => import('@/pages/admin/Team'))
const AdminAudit = lazy(() => import('@/pages/admin/Audit'))
const AccountLayout = lazy(() => import('@/pages/account/AccountLayout'))
const AccountOrders = lazy(() => import('@/pages/account/Orders'))
const AccountOrderDetail = lazy(() => import('@/pages/account/OrderDetail'))
const AccountAddresses = lazy(() => import('@/pages/account/Addresses'))
const SupplierOrders = lazy(() => import('@/pages/supplier/Orders'))
const SupplierOrderDetail = lazy(() => import('@/pages/supplier/OrderDetail'))
const AdminOrders = lazy(() => import('@/pages/admin/Orders'))
const AdminOrderDetail = lazy(() => import('@/pages/admin/OrderDetail'))
const AdminDeliveries = lazy(() => import('@/pages/admin/Deliveries'))
const AdminPayments = lazy(() => import('@/pages/admin/Payments'))
const AdminReports = lazy(() => import('@/pages/admin/Reports'))
const AdminSupplierStatement = lazy(() => import('@/pages/admin/Payouts'))
const SupplierStatement = lazy(() => import('@/pages/supplier/Statement'))
const AdminCustomers = lazy(() => import('@/pages/admin/Customers').then((m) => ({ default: m.AdminCustomers })))
const AdminCustomerDetail = lazy(() => import('@/pages/admin/Customers').then((m) => ({ default: m.AdminCustomerDetail })))
const Notifications = lazy(() => import('@/pages/shared/Notifications'))
const SupportList = lazy(() => import('@/pages/shared/Support').then((m) => ({ default: m.SupportList })))
const SupportNew = lazy(() => import('@/pages/shared/Support').then((m) => ({ default: m.SupportNew })))
const SupportDetail = lazy(() => import('@/pages/shared/Support').then((m) => ({ default: m.SupportDetail })))
const AdminSupportList = lazy(() => import('@/pages/admin/Support').then((m) => ({ default: m.AdminSupportList })))
const AdminSupportDetail = lazy(() => import('@/pages/admin/Support').then((m) => ({ default: m.AdminSupportDetail })))
const Account = lazy(() => import('@/pages/shared/Account'))

function Root() {
  return (
    <Suspense fallback={<Loading />}>
      <ScrollRestoration />
      <Outlet />
      <AuthDialog />
    </Suspense>
  )
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe()
  const [params] = useSearchParams()
  if (isLoading) return <Loading />
  if (me) {
    // Signing in flips this guard; honour ?next= so "Sign in to check out" lands on checkout.
    const next = params.get('next')
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null
    return <Navigate to={safeNext ?? homeFor(me)} replace />
  }
  return children
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/products', element: <Products /> },
          { path: '/products/:slug', element: <ProductDetail /> },
          { path: '/brands', element: <Brands /> },
          { path: '/suppliers/*', element: <Navigate to="/brands" replace /> },
          { path: '/login', element: <GuestOnly><Login /></GuestOnly> },
          { path: '/register', element: <GuestOnly><Register /></GuestOnly> },
          { path: '/forgot-password', element: <ForgotPassword /> },
          { path: '/reset-password', element: <ResetPassword /> },
          { path: '/cart', element: <Cart /> },
          { path: '/checkout', element: <Checkout /> },
          { path: '/help', element: <Help /> },
          {
            path: '/account',
            element: <AccountLayout />,
            children: [
              { index: true, element: <Navigate to="/account/orders" replace /> },
              { path: 'orders', element: <AccountOrders /> },
              { path: 'orders/:number', element: <AccountOrderDetail /> },
              { path: 'addresses', element: <AccountAddresses /> },
              { path: 'support', element: <SupportList base="/account/support" /> },
              { path: 'support/new', element: <SupportNew base="/account/support" /> },
              { path: 'support/:number', element: <SupportDetail base="/account/support" orderBase="/account/orders" /> },
              { path: 'notifications', element: <Notifications /> },
              { path: 'settings', element: <Account /> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        path: '/supplier',
        element: <SupplierLayout />,
        children: [
          { index: true, element: <SupplierDashboard /> },
          { path: 'profile', element: <SupplierProfile /> },
          { path: 'products', element: <SupplierProducts /> },
          { path: 'products/new', element: <SupplierProductForm /> },
          { path: 'products/import', element: <SupplierImport /> },
          { path: 'products/:id', element: <SupplierProductForm /> },
          { path: 'inventory', element: <SupplierInventory /> },
          { path: 'orders', element: <SupplierOrders /> },
          { path: 'orders/:number', element: <SupplierOrderDetail /> },
          { path: 'analytics', element: <SupplierAnalytics /> },
          { path: 'statement', element: <SupplierStatement /> },
          { path: 'reviews', element: <ComingSoon title="Reviews" description="Customer ratings of your products and service, after their orders are delivered." /> },
          { path: 'team', element: <SupplierTeam /> },
          { path: 'support', element: <SupportList base="/supplier/support" /> },
          { path: 'support/new', element: <SupportNew base="/supplier/support" /> },
          { path: 'support/:number', element: <SupportDetail base="/supplier/support" orderBase="/supplier/orders" /> },
          { path: 'notifications', element: <Notifications /> },
          { path: 'account', element: <Account /> },
        ],
      },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'orders', element: <AdminOrders /> },
          { path: 'orders/:number', element: <AdminOrderDetail /> },
          { path: 'deliveries', element: <AdminDeliveries /> },
          { path: 'payments', element: <AdminPayments /> },
          { path: 'payouts/:id', element: <AdminSupplierStatement /> },
          { path: 'reports', element: <AdminReports /> },
          { path: 'support', element: <AdminSupportList /> },
          { path: 'support/:number', element: <AdminSupportDetail /> },
          { path: 'customers', element: <AdminCustomers /> },
          { path: 'customers/:id', element: <AdminCustomerDetail /> },
          { path: 'suppliers', element: <AdminSuppliers /> },
          { path: 'suppliers/:id', element: <AdminSupplierDetail /> },
          { path: 'listings', element: <AdminListings /> },
          { path: 'listings/:id', element: <AdminListingReview /> },
          { path: 'catalogue', element: <AdminCatalogue /> },
          { path: 'settings', element: <AdminSettings /> },
          { path: 'team', element: <AdminTeam /> },
          { path: 'audit', element: <AdminAudit /> },
          { path: 'notifications', element: <Notifications /> },
          { path: 'account', element: <Account /> },
        ],
      },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
