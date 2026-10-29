export type UserRole = 'customer' | 'stall'
export type ImportSource = 'manual' | 'screenshot' | 'link'
export type OrderStatus = 'pending' | 'picking' | 'packed' | 'awaiting_pickup' | 'in_transit' | 'received' | 'exception' | 'completed' | 'cancelled' | 'picked'
export type AccountingStatus = 'unposted' | 'posted' | 'adjusted' | 'settled'
export type ReturnStatus = 'photo_review' | 'awaiting_goods' | 'inspection' | 'confirmed' | 'exception' | 'rejected' | 'pending'
export type PaymentStatus = 'pending' | 'received' | 'unclaimed' | 'refunded'
export type ImportTaskStatus = 'queued' | 'processing' | 'review' | 'completed' | 'failed'
export type MerchantStatus = 'profile_incomplete' | 'pending' | 'active' | 'paused' | 'disabled'

export interface ProductImage {
  fileId: string
  type: 'cover' | 'detail' | 'package' | 'display'
}

export interface Product {
  id: string
  code: string
  name: string
  price: number
  colors: string[]
  sizes: string[]
  stockReference: number
  reserved?: number
  tone: 'sand' | 'dark' | 'cream'
  status?: 'sale' | 'draft' | 'off'
  images?: ProductImage[]
  updatedAt?: string
}

export interface CartItem {
  id: string
  productId?: string
  productCode: string
  externalProductCode?: string
  name: string
  color: string
  size: string
  /** 兼容旧版本云端/本地数据；新数据与 size 保持一致。 */
  specs?: string
  quantity: number
  orderedQuantity?: number
  unitPrice: number
  originalUnitPrice?: number
  source: ImportSource
  needsReview?: boolean
  confidence?: number
}

export interface OrderSummary {
  id: string
  merchantId?: string
  merchantName: string
  date: string
  status: OrderStatus
  items: CartItem[]
  total: number
  original?: number
  adjustment?: number
  returns?: number
  discount?: number
  returnItems?: ReturnItem[]
  batchKey?: string
  revision?: number
  appendCount?: number
  accountingStatus?: AccountingStatus
  deliveryMethod?: 'pickup' | 'delivery'
  events?: BatchEvent[]
  exceptionReason?: string
  exceptionFromStatus?: OrderStatus | ''
  packingNote?: string
  requestedItems?: CartItem[]
}

export interface BatchEvent {
  id: string
  type: 'created' | 'appended' | 'corrected' | 'picking' | 'packed' | 'handover' | 'received' | 'exception' | 'posted'
  title: string
  detail?: string
  createdAt: string
  operator?: 'customer' | 'stall' | 'system'
}

export interface InventoryItem {
  productId?: string
  productCode: string
  name: string
  colors: string[]
  referenceTotal: number
  reserved: number
}

export interface MerchantProfile {
  id: string
  name: string
  contactName?: string
  phone?: string
  address?: string
  status?: MerchantStatus
  productAliases?: Array<{ externalCode: string; productId: string; productCode: string }>
}

export interface AdminCustomerSummary extends MerchantProfile {
  canViewBills?: boolean
  orderCount: number
  returnCount: number
  pendingReturnCount: number
  outstanding: number
  lastOrderDate?: string
  aliasCount: number
}

export interface AdminCustomerDetail {
  canViewBills?: boolean
  merchant: MerchantProfile
  memberCount: number
  orders: OrderSummary[]
  returns: ReturnSummary[]
  bills: BillSummary[]
}

export interface ReturnItem {
  productId?: string
  productCode: string
  color: string
  size: string
  quantity: number
  unitPrice: number
  amount: number
  condition?: 'resellable' | 'damaged' | 'wrong_item' | 'shortage' | 'sample'
}

export interface ReturnSummary {
  id: string
  orderId: string
  date: string
  status: ReturnStatus
  items: ReturnItem[]
  amount: number
  merchantId?: string
  merchantName?: string
  photos?: string[]
  receivedQuantity?: number
  exceptionReason?: string
  inventoryPosted?: boolean
}

export interface BillSummary {
  id: string
  merchantId: string
  date: string
  original: number
  adjustment: number
  returns: number
  discount: number
  payable: number
  status: 'open' | 'settled'
  openingBalance?: number
  shipped?: number
  corrections?: number
  payments?: number
  pendingPayments?: number
  closingBalance?: number
}

export interface LoginResult {
  isOwner?: boolean
  canViewBills?: boolean
  openid?: string
  role: UserRole
  authorizedRole?: UserRole
  merchantId?: string
  profileComplete?: boolean
  isNewUser?: boolean
  merchantStatus?: MerchantStatus
  demo?: boolean
}

export interface StaffApplication {
  id: string
  name: string
  phone: string
  status: 'none' | 'pending' | 'active' | 'rejected' | 'disabled'
  canViewBills: boolean
  reason: string
}

export interface StaffIdentity {
  isOwner: boolean
  isStaff: boolean
  canViewBills: boolean
  application: StaffApplication
}

export interface ImportTask {
  id: string
  source: Exclude<ImportSource, 'manual'>
  status: ImportTaskStatus
  progress?: number
  message?: string
  result?: CartItem[]
  createdAt?: string
}

export interface SubmitOrderResult {
  orderId: string
  duplicated: boolean
  totalCents: number
}

export interface BillExportResult {
  fileId: string
  fileName: string
  expiresAt?: string
}

export interface BootstrapResult {
  user: LoginResult
  merchant?: MerchantProfile
  customers?: MerchantProfile[]
  products: Product[]
  cart: CartItem[]
  orders: OrderSummary[]
  returns: ReturnSummary[]
  bills: BillSummary[]
  inventory?: InventoryItem[]
}

export interface CloudApiError {
  code: string
  message: string
  requestId?: string
}

export type CloudApiEnvelope<T> =
  | { ok: true; data: T; requestId?: string }
  | { ok: false; error: CloudApiError; requestId?: string }
