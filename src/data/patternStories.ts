import type { Product } from '@/types'

export interface PatternHotspot { x: number; y: number; label: string }
export interface PatternStory {
  productCode: string; title: string; mood: string; observation: string
  interpretation: string; sellingPoint: string; confidence: '中等' | '较高'; hotspots: PatternHotspot[]
}
export function getPatternStory(input: string | Pick<Product, 'code' | 'name' | 'colors'>): PatternStory {
  return { productCode: typeof input === 'string' ? input : input.code, title: '示例商品介绍', mood: '简约', observation: '请根据实际商品填写。', interpretation: '请根据实物核对，不自动生成材质与工艺承诺。', sellingPoint: '待填写', confidence: '中等', hotspots: [] }
}
export function hasPatternStory(_input: string | Pick<Product, 'code' | 'name' | 'colors'>) { return false }
export const auditedPatternStoryCodes: string[] = []
