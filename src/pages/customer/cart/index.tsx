import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Button, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products } from '@/data/mock'
import { useCart } from '@/store/cart'
import { bootstrapApp, isCloudReady, requestErrorDetails, saveProductAlias, submitOrder } from '@/services/cloud'
import type { CartItem, ImportSource, Product } from '@/types'
import { buildProductMap, findProduct, previewProductImages } from '@/utils/productImages'
import './index.scss'

const sourceLabel: Record<ImportSource, string> = {
  manual: '手动选购',
  screenshot: '截图导入',
  link: '链接导入'
}

export default function CustomerCartPage() {
  const cart = useCart()
  const [catalog, setCatalog] = useState<Product[]>(runtimeConfig.demoMode ? products : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mappingItem, setMappingItem] = useState<CartItem | null>(null)
  const [mappingKeyword, setMappingKeyword] = useState('')
  const idempotencyKey = useRef('')
  const productByCode = useMemo(() => buildProductMap(catalog), [catalog])
  const mappingProducts = useMemo(() => {
    const query = mappingKeyword.trim().toLowerCase()
    return catalog.filter((product) => !query || `${product.code}${product.name}${product.colors.join('')}`.toLowerCase().includes(query)).slice(0, 30)
  }, [catalog, mappingKeyword])
  const loadCatalog = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try {
      const result = await bootstrapApp()
      if (result) setCatalog(result.products)
    } catch (error) {
      setCatalog([])
      setLoadError(requestErrorDetails(error, '商品图片加载失败'))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  const mapExternalCode = async (product: Product) => {
    if (!mappingItem) return
    const externalCode = mappingItem.externalProductCode || mappingItem.productCode
    const color = product.colors.includes(mappingItem.color) ? mappingItem.color : product.colors[0]
    const size = product.sizes.map((item) => item.toUpperCase()).includes(mappingItem.size.toUpperCase()) ? mappingItem.size : product.sizes[0]
    const confirmation = await Taro.showModal({
      title: '确认款号映射',
      content: `该客户的 ${externalCode} 对应档口 ${product.code}。本条将使用 ${color}、${size}码，以后将自动转换。`
    })
    if (!confirmation.confirm) return
    Taro.showLoading({ title: '正在保存', mask: true })
    try {
      if (isCloudReady()) await saveProductAlias(externalCode, product.id)
      cart.setItems((items) => items.map((item) => item.id === mappingItem.id ? {
        ...item, productId: product.id, productCode: product.code, externalProductCode: externalCode,
        name: product.name, color, size, specs: size, unitPrice: product.price, needsReview: false
      } : item))
      setMappingItem(null); setMappingKeyword('')
      Taro.showToast({ title: '映射已保存', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '映射保存失败', icon: 'none' })
    } finally { Taro.hideLoading() }
  }

  const submit = async () => {
    if (submitting) return
    if (cart.items.some((item) => item.needsReview || !item.productId)) {
      Taro.showToast({ title: '请先完成外部款号映射', icon: 'none' })
      return
    }
    if (!cart.items.length) {
      Taro.showToast({ title: '订货车还是空的', icon: 'none' })
      return
    }
    const result = await Taro.showModal({ title: '提交订单', content: `确认提交 ${cart.count} 件商品，共 ¥${cart.total}？` })
    if (!result.confirm) return
    setSubmitting(true)
    Taro.showLoading({ title: '正在提交', mask: true })
    try {
      if (isCloudReady()) {
        if (!idempotencyKey.current) idempotencyKey.current = `miniapp-${Date.now()}-${Math.random().toString(36).slice(2)}`
        await submitOrder(cart.items, idempotencyKey.current)
        cart.clear()
        idempotencyKey.current = ''
      }
      Taro.showToast({ title: '订单已同步至示例档口', icon: 'none', duration: 1800 })
      setTimeout(() => Taro.redirectTo({ url: '/pages/customer/orders/index' }), 900)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '订单提交失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
      setSubmitting(false)
    }
  }

  return (
    <>
      <AppHeader title='订货车' back />
      <View className='page cart-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadCatalog} />
        {!loading && !loadError && <>
        <View className='row between cart-page__summary'>
          <Text className='title'>订货明细</Text>
          <Text className='sub'>{new Set(cart.items.map((item) => item.productCode)).size}款 · {cart.count}件</Text>
        </View>

        <View className='card'>
          {cart.items.map((item) => {
            const product = findProduct(productByCode, item.productCode)
            return (
              <View key={item.id} className='cart-item'>
                <ProductImage className='cart-item__photo' code={item.productCode} images={product?.images} onClick={() => previewProductImages(product?.images)} />
                <View className='grow cart-item__content'>
                  <View className='row between cart-item__head'>
                    <Text className='cart-item__name'>{item.productCode} {item.name}</Text>
                    <Text className='price cart-item__price'>¥{item.unitPrice * item.quantity}</Text>
                  </View>
                  <Text className='sub cart-item__spec'>{item.color} · {item.size}码 · 共{item.quantity}件</Text>
                  <View className='row between cart-item__footer'>
                    {item.needsReview
                      ? <Text className='pill yellow' onClick={() => setMappingItem(item)}>{sourceLabel[item.source]} · 选择档口款号</Text>
                      : <Text className='pill green'>{sourceLabel[item.source]}{item.externalProductCode ? ` · 客户${item.externalProductCode}→档口${item.productCode}` : ' · 已确认'}</Text>}
                    <View className='row cart-item__quantity'><Text onClick={() => cart.updateQuantity(item.id, item.quantity - 1)}>−</Text><Text>{item.quantity}</Text><Text onClick={() => cart.updateQuantity(item.id, item.quantity + 1)}>＋</Text></View>
                  </View>
                </View>
              </View>
            )
          })}
        </View>

        <View className='card cart-page__total'>
          <View className='row between'><Text>应付合计</Text><Text className='price cart-page__amount'>¥{cart.total}</Text></View>
          <Text className='mini'>提交前可返回修改款号、花色、尺码和数量</Text>
        </View>
        <Button loading={submitting} disabled={submitting} className='primary-btn' onClick={submit}>确认无误，提交订单</Button>
        </>}
      </View>
      {mappingItem && <View className='sheet-mask' onClick={() => setMappingItem(null)}><View className='sheet cart-mapping' onClick={(event) => event.stopPropagation()}>
        <View className='row between'><View><Text className='title'>选择档口款号</Text><Text className='sub'>客户外部款号：{mappingItem.externalProductCode || mappingItem.productCode}</Text></View><Text onClick={() => setMappingItem(null)}>×</Text></View>
        <View className='search-box'><Text>⌕</Text><Input className='search-input' value={mappingKeyword} onInput={(event) => setMappingKeyword(event.detail.value)} placeholder='搜索档口款号或名称' /></View>
        {mappingProducts.map((product) => <View className='cart-mapping__item' key={product.id} onClick={() => mapExternalCode(product)}>
          <ProductImage className='cart-mapping__image' code={product.code} images={product.images} />
          <View className='grow'><Text className='title'>{product.code} {product.name}</Text><Text className='sub'>{product.colors.join('、')} · {product.sizes.join('/')}</Text></View><Text>选择 ›</Text>
        </View>)}
      </View></View>}
    </>
  )
}
