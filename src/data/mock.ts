import type { CartItem, InventoryItem, OrderSummary } from '@/types'
import { importedProducts } from './products.generated'

export const products = importedProducts
export const demoDate = new Date().toISOString().slice(0, 10)
export const cartItems: CartItem[] = []
export const inventoryItems: InventoryItem[] = products.map((item) => ({ productCode: item.code, name: item.name, colors: item.colors, referenceTotal: 0, reserved: 0 }))
export const todayOrder: OrderSummary = { id: 'demo-order', merchantId: 'demo-customer', merchantName: '示例客户', date: demoDate, status: 'pending', items: [], total: 0, accountingStatus: 'unposted', events: [] }
export function withLocalProductCovers(catalog: typeof products): typeof products {
  return [...catalog].sort((a, b) => a.code.localeCompare(b.code, 'zh-CN', { numeric: true }))
}
