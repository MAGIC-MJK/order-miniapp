import { View, Text, Button } from '@tarojs/components'
import ProductImage from '@/components/ProductImage'
import { hasPatternStory } from '@/data/patternStories'
import { productCategoryLabels } from '@/data/productCategories'
import type { Product } from '@/types'
import './index.scss'

type ProductCardProps = {
  product: Product
  layout: 'list' | 'grid'
  onSelect: (product: Product) => void
}

export default function ProductCard({ product, layout, onSelect }: ProductCardProps) {
  const categoryLabels = productCategoryLabels(product)

  return (
    <View className={`product-card product-card--${layout} card`}>
      <ProductImage className={`product-card__photo ${product.tone}`} code={product.code} images={product.images} onClick={() => onSelect(product)} />
      <View className='grow product-card__content'>
        <Text className='product-card__name'>{product.code} {product.name}</Text>
        <View className='product-card__categories'>
          {categoryLabels.map((label) => <Text key={label}>{label}</Text>)}
        </View>
        <Text className='sub product-card__meta'>{product.colors.join(' / ')}</Text>
        {hasPatternStory(product) && <Text className='product-card__story-tag'>纹 · 可查看设计解读</Text>}
        <View className='row between product-card__bottom'>
          <Text className='price'>¥{product.price}</Text>
          <Button className='product-card__select' onClick={() => onSelect(product)}>选规格</Button>
        </View>
      </View>
    </View>
  )
}
