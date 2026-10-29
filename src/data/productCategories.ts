import type { Product } from '@/types'

export type ProductCategoryId = 'all' | 'spring-autumn' | 'summer' | 'winter' | 'straight' | 'curved'

export interface ProductCategory {
  id: ProductCategoryId
  label: string
  group: '季节' | '裤型'
}

export const productCategories: ProductCategory[] = [
  { id: 'all', label: '全部', group: '季节' },
  { id: 'spring-autumn', label: '春秋款', group: '季节' },
  { id: 'summer', label: '夏款', group: '季节' },
  { id: 'winter', label: '冬款加绒', group: '季节' },
  { id: 'straight', label: '直筒', group: '裤型' },
  { id: 'curved', label: '弯刀', group: '裤型' }
]

// 依据“示例档口”归档实拍图核对；新款上架时应由档口再确认裤型。
const curvedProductCodes = new Set([
  '218', '318', '512', '513', '515', '521', '555', '669',
  '802', '803', '806', '807', '818', '819', 'XJ_094610_555', 'XJ_144742_802'
])

export function productSeasonCategory(product: Pick<Product, 'code' | 'name'>): Exclude<ProductCategoryId, 'all' | 'straight' | 'curved'> {
  if (product.name.includes('夏季')) return 'summer'
  if (product.name.includes('冬季')) return 'winter'
  // XJ_144742_802 与 802 为同图同款系列，归入春秋款。
  return 'spring-autumn'
}

export function productFitCategory(product: Pick<Product, 'code'>): 'straight' | 'curved' {
  return curvedProductCodes.has(product.code.trim().toUpperCase()) ? 'curved' : 'straight'
}

export function productMatchesCategory(product: Pick<Product, 'code' | 'name'>, category: ProductCategoryId) {
  if (category === 'all') return true
  if (category === 'straight' || category === 'curved') return productFitCategory(product) === category
  return productSeasonCategory(product) === category
}

export function productCategoryLabels(product: Pick<Product, 'code' | 'name'>) {
  const season = productCategories.find((item) => item.id === productSeasonCategory(product))?.label || '春秋款'
  const fit = productFitCategory(product) === 'curved' ? '弯刀' : '直筒'
  return [season, fit]
}
