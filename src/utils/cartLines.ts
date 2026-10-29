import type { CartItem } from '@/types'

const SPEC_SEPARATOR = /[、,，;；/]+/
const SPEC_QUANTITY = /^\s*(.+?)\s*[×xX*]\s*(\d+)\s*件?\s*$/

function cleanSize(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function itemSize(item: Pick<CartItem, 'size' | 'specs'>) {
  return cleanSize(item.size || item.specs)
}

export function expandLegacyCartItem(item: CartItem): CartItem[] {
  const explicitSize = cleanSize(item.size)
  if (explicitSize) return [{ ...item, size: explicitSize, specs: explicitSize }]

  const legacySpecs = String(item.specs || '').trim()
  const segments = legacySpecs.split(SPEC_SEPARATOR).map((segment) => segment.trim()).filter(Boolean)
  const parsed = segments.map((segment) => segment.match(SPEC_QUANTITY))
  if (parsed.length && parsed.every(Boolean)) {
    return parsed.map((match, index) => {
      const size = cleanSize(match?.[1])
      const quantity = Number(match?.[2])
      return {
        ...item,
        id: index === 0 ? item.id : `${item.id || 'line'}-${index + 1}`,
        size,
        specs: size,
        quantity
      }
    })
  }

  const fallbackSize = cleanSize(legacySpecs.replace(/\s*[×xX*]\s*\d+\s*件?\s*$/, ''))
  return [{ ...item, size: fallbackSize, specs: fallbackSize }]
}

export function normaliseCartItems(items: CartItem[]) {
  return items.flatMap(expandLegacyCartItem).filter((item) => item.size && item.quantity > 0)
}

export function normaliseOrderItems<T extends { items: CartItem[] }>(orders: T[]) {
  return orders.map((order) => ({ ...order, items: normaliseCartItems(order.items || []) }))
}

export function mergeCartLines(current: CartItem[], incoming: CartItem[]) {
  const next = normaliseCartItems(current).map((item) => ({ ...item }))
  normaliseCartItems(incoming).forEach((line) => {
    const index = next.findIndex((item) =>
      item.productCode.trim().toUpperCase() === line.productCode.trim().toUpperCase() &&
      item.color === line.color &&
      item.size === line.size
    )
    if (index >= 0) {
      next[index] = {
        ...next[index],
        quantity: next[index].quantity + line.quantity,
        needsReview: Boolean(next[index].needsReview || line.needsReview),
        confidence: Math.min(next[index].confidence ?? 1, line.confidence ?? 1)
      }
    } else {
      next.push({
        ...line,
        id: line.id || `cart-${Date.now()}-${next.length}`,
        specs: line.size
      })
    }
  })
  return next
}
