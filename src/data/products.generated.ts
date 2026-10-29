import type { Product } from '@/types'

// 虚构示例商品，不含运营方商品资料或图片。
export const importedProducts: Product[] = [
  { id: 'sample-607', code: '607', name: '示例直筒裤', price: 65, colors: ['白色', '黑色'], sizes: ['XL', '2XL', '3XL', '4XL'], stockReference: 0, tone: 'sand', status: 'sale', images: [] },
  { id: 'sample-606', code: '606', name: '示例阔腿裤', price: 40, colors: ['白色', '黑色'], sizes: ['XL', '2XL', '3XL', '4XL'], stockReference: 0, tone: 'cream', status: 'sale', images: [] },
  { id: 'sample-605', code: '605', name: '示例休闲裤', price: 65, colors: ['白色', '黑色'], sizes: ['XL', '2XL', '3XL', '4XL'], stockReference: 0, tone: 'dark', status: 'sale', images: [] }
]
