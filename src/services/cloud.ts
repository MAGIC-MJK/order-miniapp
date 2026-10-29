import Taro from '@tarojs/taro'
import { runtimeConfig, assertCloudConfigured } from '@/config/runtime'
import { readRole } from '@/utils/navigation'
import type {
  BillExportResult,
  AdminCustomerDetail,
  AdminCustomerSummary,
  BootstrapResult,
  CartItem,
  CloudApiEnvelope,
  ImportTask,
  LoginResult,
  Product,
  OrderStatus,
  ReturnItem,
  ReturnSummary,
  SubmitOrderResult,
  StaffApplication,
  StaffIdentity
} from '@/types'

let cloudInitialised = false

export class CloudRequestError extends Error {
  code: string
  requestId?: string

  constructor(message: string, code = 'CLOUD_ERROR', requestId?: string) {
    super(message)
    this.name = 'CloudRequestError'
    this.code = code
    this.requestId = requestId
  }
}

export function requestErrorDetails(error: unknown, fallback = '加载失败') {
  if (error instanceof CloudRequestError) return { message: error.message, requestId: error.requestId }
  if (error instanceof Error) return { message: error.message || fallback, requestId: undefined }
  return { message: fallback, requestId: undefined }
}

export function initCloud() {
  if (cloudInitialised) return true
  if (!runtimeConfig.cloudEnvId || !Taro.cloud) return false
  Taro.cloud.init({ env: runtimeConfig.cloudEnvId, traceUser: true })
  cloudInitialised = true
  return true
}

export function isCloudReady() {
  return Boolean(runtimeConfig.cloudEnvId && Taro.cloud)
}

export async function callApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  assertCloudConfigured()
  initCloud()
  const result = await Taro.cloud.callFunction({
    name: runtimeConfig.apiFunction,
    data: { action, payload, viewAs: readRole() }
  })
  const envelope = result.result as CloudApiEnvelope<T>
  if (!envelope || typeof envelope !== 'object') throw new CloudRequestError('云函数返回格式不正确', 'INVALID_ENVELOPE')
  if (!envelope.ok) {
    const requestId = envelope.error.requestId || envelope.requestId
    console.error('[CloudRequestError]', { action, code: envelope.error.code, requestId })
    throw new CloudRequestError(envelope.error.message || '云端操作失败', envelope.error.code, requestId)
  }
  return envelope.data
}

export async function getWechatPhoneNumber(code: string) {
  return callApi<{ phone: string }>('profile.phone', { code })
}

export async function loginWithWechat(requestedRole: 'customer' | 'stall'): Promise<LoginResult> {
  if (!isCloudReady()) return { role: requestedRole, demo: true }
  return callApi<LoginResult>('auth.login', { requestedRole })
}

export async function bootstrapApp(): Promise<BootstrapResult | null> {
  if (!isCloudReady()) return null
  return callApi<BootstrapResult>('app.bootstrap')
}

export async function updateMerchantProfile(profile: { shopName: string; contactName: string; phone: string; address: string }) {
  return callApi<{ saved: boolean; merchantId: string; status: string }>('profile.update', { profile })
}

export function listAdminCustomers() {
  return callApi<{ items: AdminCustomerSummary[] }>('admin.customer.list')
}

export function getStaffIdentity() {
  return callApi<StaffIdentity>('staff.me')
}

export function applyForStaff(name: string, phone: string, agreed: boolean) {
  return callApi<{ saved: boolean }>('staff.apply', { name, phone, agreed })
}

export function listStaff() {
  return callApi<{ items: StaffApplication[] }>('staff.list')
}

export function reviewStaff(id: string, status: 'active' | 'rejected' | 'disabled', canViewBills = false, reason = '') {
  return callApi<{ saved: boolean }>('staff.review', { id, status, canViewBills, reason })
}

export function getAdminCustomerDetail(merchantId: string) {
  return callApi<AdminCustomerDetail>('admin.customer.detail', { merchantId })
}

export function updateAdminCustomerStatus(merchantId: string, status: 'pending' | 'active' | 'paused' | 'disabled') {
  return callApi<{ merchantId: string; status: string }>('admin.customer.status', { merchantId, status })
}

export async function uploadFiles(tempPaths: string[], folder = 'uploads') {
  assertCloudConfigured()
  initCloud()
  return Promise.all(tempPaths.map(async (tempPath, index) => {
    const extension = tempPath.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1] || 'jpg'
    const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '') || 'uploads'
    const cloudPath = `${safeFolder}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${index}.${extension}`
    const result = await Taro.cloud.uploadFile({ cloudPath, filePath: tempPath })
    return result.fileID
  }))
}

export function uploadImportImages(tempPaths: string[]) {
  return uploadFiles(tempPaths, 'imports')
}

export async function createImportTask(input: { source: 'screenshot'; fileIds: string[] } | { source: 'link'; url: string }) {
  return callApi<ImportTask>('import.create', input)
}

export async function getImportTask(taskId: string) {
  return callApi<ImportTask>('import.get', { taskId })
}

export async function listImportTasks() {
  return callApi<{ items: ImportTask[] }>('import.list')
}

export async function applyImportTask(taskId: string) {
  return callApi<{ items: CartItem[] }>('import.apply', { taskId })
}

export async function waitForImport(taskId: string, timeoutMs = 30000, onProgress?: (task: ImportTask) => void) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const task = await getImportTask(taskId)
    onProgress?.(task)
    if (task.status === 'completed' || task.status === 'review') return task
    if (task.status === 'failed') throw new Error(task.message || '导单识别失败')
    await new Promise((resolve) => setTimeout(resolve, 1800))
  }
  throw new CloudRequestError('任务已提交，但档口本地识别服务尚未返回。任务会保留在导单记录中。', 'IMPORT_PENDING')
}

export async function submitOrder(items: CartItem[], idempotencyKey: string) {
  return callApi<SubmitOrderResult>('order.submit', { items, idempotencyKey })
}

export async function syncCart(items: CartItem[]) {
  if (!isCloudReady()) return
  await callApi<{ saved: boolean }>('cart.save', { items })
}

export async function transitionOrder(orderId: string, nextStatus: OrderStatus, packedItems?: Array<{ lineId?: string; productId?: string; quantity: number }>, input: { note?: string; revision?: number } = {}) {
  return callApi<{ status: OrderStatus; duplicated: boolean }>('order.transition', { orderId, nextStatus, packedItems, ...input })
}

export async function appendOrderCorrection(orderId: string, note: string) {
  return callApi<{ revision: number }>('order.correct', { orderId, note, idempotencyKey: `${Date.now()}` })
}

export async function acknowledgeOrder(orderId: string, action: 'received' | 'issue', note = '') {
  return callApi<{ status: OrderStatus }>('order.acknowledge', { orderId, action, note })
}

export async function submitReturn(input: { orderId: string; items: ReturnItem[]; fileIds: string[] }) {
  return callApi<ReturnSummary>('return.submit', input)
}

export async function transitionReturn(returnId: string, nextStatus: 'awaiting_goods' | 'inspection' | 'confirmed' | 'exception', input: { receivedQuantity?: number; exceptionReason?: string } = {}) {
  return callApi<ReturnSummary>('return.transition', { returnId, nextStatus, ...input })
}

export async function saveProduct(product: Product) {
  return callApi<{ productId: string }>('product.upsert', { product })
}

export async function saveProductAlias(externalCode: string, productId: string, merchantId?: string) {
  return callApi<{ externalCode: string; productId: string; productCode: string }>('product.alias.save', { externalCode, productId, merchantId })
}

export async function seedDatabase() {
  return callApi<{ seeded: number }>('admin.seed')
}

export async function addStock(input: { productId: string; quantity: number; colors?: string[]; note?: string }) {
  return callApi<{ referenceTotal: number }>('inventory.addStock', input)
}

export async function adjustBill(payload: Record<string, unknown>) {
  return callApi<{ payableCents: number }>('bill.adjust', payload)
}

export async function exportBill(date: string) {
  return callApi<BillExportResult>('bill.export', { date })
}

export async function openExportedBill(fileId: string) {
  assertCloudConfigured()
  initCloud()
  Taro.showLoading({ title: '下载账单', mask: true })
  let result: Awaited<ReturnType<typeof Taro.cloud.downloadFile>>
  try {
    result = await Taro.cloud.downloadFile({ fileID: fileId })
  } finally {
    Taro.hideLoading()
  }
  await Taro.openDocument({ filePath: result.tempFilePath, fileType: 'xlsx', showMenu: true })
  void callApi<{ deleted: boolean }>('file.deleteExport', { fileId }).catch(() => undefined)
}
