export type Role = 'admin' | 'supplier' | 'customer'
export type MemberRole = 'owner' | 'manager' | 'sales' | 'inventory'
export type SupplierStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type ListingStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'archived'
export type Condition = 'new' | 'refurbished' | 'used'
export type Availability = 'in_stock' | 'out_of_stock' | 'on_request'

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Me {
  id: number
  email: string
  full_name: string
  phone: string
  role: Role
  admin_scope: 'full' | 'orders'
  supplier: null | {
    id: number
    name: string
    slug: string
    status: SupplierStatus
    is_verified: boolean
    member_role: MemberRole
    logo_url: string
  }
}

export interface Ref {
  id: number
  name: string
  slug: string
}
export interface CategoryNode extends Ref {
  description: string
  children: CategoryNode[]
}
export interface Category extends Ref {
  parent: number | null
  description: string
  is_active: boolean
  position: number
}
export interface Brand extends Ref {
  logo_url: string
  is_active: boolean
  product_count?: number
}
export interface BusinessCategory extends Ref {
  is_active: boolean
}
export interface Image {
  id: number
  url: string
  alt_text: string
  position: number
}
export interface Spec {
  name: string
  value: string
}

export interface SupplierBadge {
  id: number
  name: string
  slug: string
  logo_url: string
  is_verified: boolean
  county: string
  town: string
}

export interface PublicSupplier {
  id: number
  name: string
  slug: string
  tagline: string
  description: string
  brands_distributed: string
  warranty_policy: string
  year_established: number | null
  business_categories: BusinessCategory[]
  county: string
  town: string
  business_hours: string
  logo_url: string
  cover_url: string
  is_verified: boolean
  member_since: string
  product_count: number
}

export interface SupplierProfile extends Omit<PublicSupplier, 'product_count'> {
  registration_number: string
  tax_pin: string
  physical_address: string
  website: string
  business_email: string
  business_phone: string
  payout_details: string
  status: SupplierStatus
  status_reason: string
  reviewed_at: string | null
}

export interface SupplierDocument {
  id: number
  doc_type: 'registration' | 'tax' | 'distribution' | 'other'
  doc_type_display: string
  title: string
  original_name: string
  file_format: string
  size_bytes: number
  status: 'pending' | 'accepted' | 'rejected'
  review_note: string
  reviewed_at: string | null
  created_at: string
}

export interface Member {
  id: number
  email: string
  full_name: string
  role: MemberRole
  is_active: boolean
  last_login: string | null
  created_at: string
}

export interface ProductCard {
  id: number
  name: string
  slug: string
  part_number: string
  brand: Ref
  category: Ref
  image: string | null
  min_price: string
  offer_count: number
  in_stock: boolean
  conditions: Condition[]
  fits: string[]
  quick_add: { listing_id: number; quantity: number } | null
  deal_percent: number | null
  was_price: string | null
}

export interface Offer {
  id: number
  condition: Condition
  price: string
  availability: Availability
  in_stock: boolean
  quantity: number
  min_order_quantity: number
  warranty: string
  notes: string
  images: Image[]
  deal: { percent: number; title: string; ends_at: string | null; was_price: string } | null
}

export interface ProductDetail {
  id: number
  name: string
  slug: string
  part_number: string
  brand: Ref
  category: Ref
  breadcrumbs: { name: string; slug: string }[]
  description: string
  specifications: Spec[]
  compatibility: string
  images: Image[]
  offers: Offer[]
}

export interface ListingProduct {
  id: number
  name: string
  slug: string
  part_number: string
  brand: Ref
  category: Ref
  description: string
  specifications: Spec[]
  compatibility: string
  status: 'pending' | 'active' | 'inactive'
  images: Image[]
}

export interface Listing {
  id: number
  product: ListingProduct
  sku: string
  condition: Condition
  notes: string
  supplier_price: string
  customer_price: string
  quantity: number
  min_order_quantity: number
  low_stock_threshold: number | null
  is_low_stock: boolean
  warranty: string
  availability: Availability
  status: ListingStatus
  status_display: string
  rejection_reason: string
  submitted_at: string | null
  approved_at: string | null
  view_count: number
  images: Image[]
  can_edit_product: boolean
  created_at: string
  updated_at: string
  matched_existing_product?: boolean
  deal: ListingDeal | null
}

export interface ListingDeal {
  percent: number
  title: string
  ends_at: string | null
  status: 'pending' | 'approved' | 'rejected' | 'ended'
  status_display: string
  note: string
  active: boolean
  customer_price: string
  supplier_price: string
}

export interface ListingEvent {
  id: number
  action: string
  actor_name: string | null
  note: string
  changes: Record<string, [unknown, unknown]>
  created_at: string
}

export interface AdminListing extends Listing {
  supplier: SupplierBadge
  supplier_status: SupplierStatus
  price_override: string | null
  events: ListingEvent[] | null
  other_offers:
    | null
    | { id: number; supplier: string; condition: Condition; status: ListingStatus; supplier_price: string; customer_price: string }[]
}

export interface CatalogueMatch {
  id: number
  name: string
  part_number: string
  brand: Ref
  category: Ref
  description: string
  specifications: Spec[]
  compatibility: string
}

export interface StockMovement {
  id: number
  listing: number
  product_name: string
  sku: string
  change: number
  quantity_after: number
  reason: string
  note: string
  user_name: string | null
  created_at: string
}

export interface Notification {
  id: number
  kind: string
  title: string
  body: string
  link: string
  read_at: string | null
  created_at: string
}

// --- Orders -------------------------------------------------------------------------------

export interface QuoteLine {
  listing_id: number
  quantity: number
  error: string
  unit_price?: string
  line_total?: string
  product?: { name: string; slug: string; part_number: string; brand: string; image: string | null }
  condition?: Condition
  availability?: Availability
  warranty?: string
  available_quantity?: number | null
  min_order_quantity?: number
}

export interface Quote {
  lines: QuoteLine[]
  subtotal: string
  delivery_fee: string
  total: string
  free_delivery_threshold: string
  county: string
  delivery_available: boolean
  delivery_days: [number, number] | null
  has_errors: boolean
}

export interface County {
  county: string
  fee: string
  days_min: number | null
  days_max: number | null
  available: boolean
  towns: string[]
}

export interface DeliveryRate {
  id: number
  county: string
  fee: string
  days_min: number
  days_max: number
  is_active: boolean
  updated_at: string
}

export type RefundMethod = 'cash' | 'bank_transfer' | 'other'


export interface Address {
  id: number
  label: string
  recipient_name: string
  phone: string
  county: string
  town: string
  street_address: string
  delivery_notes: string
  is_default: boolean
}

export type OrderStatus = 'pending' | 'confirmed' | 'dispatched' | 'delivered' | 'completed' | 'cancelled'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded'
// New orders are 'to_be_agreed' (settled on the confirmation call); the others are recorded payments and older orders.
export type PaymentMethod = 'to_be_agreed' | 'cash_on_delivery' | 'bank_transfer'
export type SupplierOrderStatus =
  | 'on_hold' | 'incoming' | 'accepted' | 'processing' | 'ready' | 'collected' | 'completed' | 'rejected' | 'cancelled'

export interface TimelineEvent {
  id: number
  kind: string
  message: string
  created_at: string
}

export interface CustomerOrderSummary {
  number: string
  status: OrderStatus
  status_display: string
  stage: string
  total: string
  payment_status: PaymentStatus
  item_count: number
  created_at: string
}

export interface CustomerOrder extends CustomerOrderSummary {
  items: {
    id: number
    product_name: string
    product_slug: string
    part_number: string
    brand_name: string
    condition: Condition
    warranty: string
    quantity: number
    unit_price: string
    line_total: string
    status: 'active' | 'cancelled'
  }[]
  timeline: TimelineEvent[]
  subtotal: string
  delivery_fee: string
  amount_paid: string
  balance_due: string
  payment_method: PaymentMethod
  payment_method_display: string
  payment_status_display: string
  recipient_name: string
  phone: string
  county: string
  town: string
  street_address: string
  delivery_notes: string
  customer_notes: string
  courier: string
  tracking_number: string
  dispatched_at: string | null
  delivered_at: string | null
  cancel_reason: string
  can_cancel: boolean
  courier_phone: string
  expected_delivery_date: string | null
  amount_refunded: string
  refunds: { amount: string; refunded_at: string; reference: string }[]
  verified_at: string | null
}

export interface SupplierOrderSummary {
  id: number
  number: string
  status: SupplierOrderStatus
  status_display: string
  released_at: string | null
  accepted_at: string | null
  ready_at: string | null
  collected_at: string | null
  item_count: number
  supplier_total: string
}

export interface SupplierOrderDetail extends SupplierOrderSummary {
  items: {
    id: number
    listing: number
    product_name: string
    part_number: string
    brand_name: string
    condition: Condition
    sku: string
    warranty: string
    on_request: boolean
    quantity: number
    supplier_unit_price: string
    supplier_line_total: string
    status: 'active' | 'cancelled'
  }[]
  timeline: TimelineEvent[]
  rejection_reason: string
  supplier_notes: string
}

export interface AdminOrderSummary {
  number: string
  status: OrderStatus
  status_display: string
  customer_name: string
  phone: string
  town: string
  total: string
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  supplier_count: number
  attention: string
  created_at: string
  county: string
  courier: string
  courier_phone: string
  tracking_number: string
  dispatched_at: string | null
  expected_delivery_date: string | null
  delivery_attempts: number
  call_attempts: number
  last_call_at: string | null
}

export interface AdminOrderItem {
  id: number
  listing: number
  product_id: number
  product_name: string
  product_slug: string
  part_number: string
  brand_name: string
  condition: Condition
  sku: string
  on_request: boolean
  quantity: number
  unit_price: string
  line_total: string
  supplier_unit_price?: string
  supplier_line_total?: string
  status: 'active' | 'cancelled'
  stock_reserved: boolean
}

export interface AdminSupplierOrder {
  id: number
  number: string
  supplier: SupplierBadge
  supplier_phone: string
  supplier_address: string
  status: SupplierOrderStatus
  status_display: string
  released_at: string | null
  accepted_at: string | null
  ready_at: string | null
  collected_at: string | null
  rejection_reason: string
  supplier_notes: string
  items: AdminOrderItem[]
}

export interface PaymentRow {
  id: number
  method: PaymentMethod
  method_display: string
  amount: string
  reference: string
  note: string
  received_at: string
  recorded_by: string | null
}

export interface RefundRow {
  id: number
  method: RefundMethod
  method_display: string
  amount: string
  reference: string
  reason: string
  refunded_at: string
  recorded_by: string | null
}

export type OrderRef = { number: string; customer_name: string; total: string }

export interface PaymentSummary {
  days: number
  received: string
  refunded: string
  net: string
  by_method: { method: PaymentMethod; total: string; count: number }[]
  outstanding: string
  outstanding_orders: number
  delivered_unpaid: number
  refund_due_orders: number
}

export interface AdminOrder extends AdminOrderSummary {
  suggested_delivery_fee: string
  customer: { id: number; full_name: string; email: string; phone: string; order_count: number }
  recipient_name: string
  county: string
  street_address: string
  delivery_notes: string
  customer_notes: string
  admin_notes: string
  subtotal: string
  delivery_fee: string
  amount_paid: string
  balance_due: string
  /** Missing for orders staff: they never see supplier costs. */
  supplier_cost?: string
  verified_at: string | null
  delivered_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string
  supplier_orders: AdminSupplierOrder[]
  events: (TimelineEvent & { actor: string | null; supplier_order: string | null; visible_to_customer: boolean; visible_to_supplier: boolean })[]
  payments: PaymentRow[]
  refunds: RefundRow[]
  amount_refunded: string
  refund_due: string
}

export interface CheckoutOptions {
  delivery_fee: string
  free_delivery_threshold: string
}

// --- Support ------------------------------------------------------------------------------------

export type TicketStatus = 'open' | 'answered' | 'resolved'
export type TicketCategory = 'order' | 'delivery' | 'payment' | 'product' | 'account' | 'other'

export interface TicketSummary {
  number: string
  subject: string
  category: TicketCategory
  category_display: string
  status: TicketStatus
  status_display: string
  order_number: string | null
  supplier_order_number: string | null
  last_message_at: string
  created_at: string
}

export interface TicketMessage {
  id: number
  author: string
  from_staff: boolean
  internal?: boolean
  body: string
  created_at: string
}

export interface Ticket extends TicketSummary {
  messages: TicketMessage[]
}

export interface AdminTicketSummary extends TicketSummary {
  requester: { kind: 'customer' | 'supplier'; name: string; person: string; email: string; phone: string; id: number }
  assigned_to: string | null
  assigned_to_id: number | null
  priority: 'normal' | 'high'
  priority_display: string
}

export interface AdminTicket extends AdminTicketSummary {
  messages: (TicketMessage & { internal: boolean })[]
}

export interface PublicConfig {
  currency: string
  support: { phone: string; whatsapp: string; email: string; hours: string }
  google_client_id: string
}
