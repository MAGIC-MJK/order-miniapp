import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { inventoryItems, products, withLocalProductCovers } from '@/data/mock'
import { addStock, bootstrapApp, isCloudReady, requestErrorDetails } from '@/services/cloud'
import type { InventoryItem, Product } from '@/types'
import { buildProductMap, findProduct, previewProductImages } from '@/utils/productImages'
import './index.scss'

export default function StallInventoryPage() {
  const [adding, setAdding] = useState(false)
  const [items, setItems] = useState<InventoryItem[]>(runtimeConfig.demoMode ? inventoryItems : [])
  const [catalog, setCatalog] = useState<Product[]>(runtimeConfig.demoMode ? products : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const [keyword, setKeyword] = useState('')
  const [form, setForm] = useState({ productCode: '503', quantity: '', colors: '', note: '' })

  const loadInventory = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try {
      const result = await bootstrapApp()
      setItems(result?.inventory || [])
      setCatalog(withLocalProductCovers(result?.products || []))
    } catch (error) {
      setItems([]); setCatalog([]); setLoadError(requestErrorDetails(error, '库存加载失败'))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadInventory() }, [loadInventory])

  const visibleItems = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) => `${item.productCode}${item.name}${item.colors.join('')}`.toLowerCase().includes(query))
  }, [items, keyword])
  const total = items.reduce((sum, item) => sum + item.referenceTotal, 0)
  const productByCode = useMemo(() => buildProductMap(catalog), [catalog])
  const selected = items.find((item) => item.productCode === form.productCode.trim())
  const incoming = Math.max(0, Number(form.quantity) || 0)

  const confirmStock = async () => {
    if (!selected || !incoming) {
      Taro.showToast({ title: '请填写有效款号和到货数量', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '正在入库', mask: true })
    try {
      let referenceTotal = selected.referenceTotal + incoming
      if (isCloudReady()) {
        const result = await addStock({
          productId: selected.productId || '',
          quantity: incoming,
          colors: form.colors.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean),
          note: form.note
        })
        referenceTotal = result.referenceTotal
      }
      setItems((current) => current.map((item) => item.productCode === selected.productCode ? { ...item, referenceTotal } : item))
      setAdding(false)
      setForm({ productCode: selected.productCode, quantity: '', colors: '', note: '' })
      Taro.showToast({ title: '入库流水已记录', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '入库失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  return (
    <>
      <AppHeader title='库存' subtitle='总库存为参考值' />
      <View className='page inventory-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadInventory} />
        {!loading && !loadError && <>
        <View className='inventory-stats'><View><Text className='title'>{items.length}</Text><Text className='mini'>款式</Text></View><View><Text className='title'>{total}</Text><Text className='mini'>总库存参考</Text></View><View><Text className='price title'>{items.filter((item) => item.referenceTotal - item.reserved < 20).length}</Text><Text className='mini'>低库存</Text></View></View>
        <View className='search-box'><Text>⌕</Text><Input className='search-input' value={keyword} onInput={(event) => setKeyword(event.detail.value)} placeholder='搜索款号、名称、花色' /></View>

        {visibleItems.map((item) => {
          const available = item.referenceTotal - item.reserved
          return (
            <View key={item.productCode} className='card inventory-card'>
              <View className='inventory-card__main'>
                <ProductImage className='inventory-card__image' code={item.productCode} images={findProduct(productByCode, item.productCode)?.images} onClick={() => previewProductImages(findProduct(productByCode, item.productCode)?.images)} />
                <View className='grow'><View className='row between'><Text className='title'>{item.productCode} {item.name}</Text><Text className='pill yellow'>参考总库存 {item.referenceTotal}</Text></View><Text className='sub'>{item.colors.join(' / ')} · 未按尺码拆分</Text></View>
              </View>
              <View className='inventory-card__stats'><View><Text>{item.referenceTotal}</Text><Text className='mini'>账面参考</Text></View><View><Text>{item.reserved}</Text><Text className='mini'>订单占用</Text></View><View><Text>{available}</Text><Text className='mini'>参考可用</Text></View></View>
              <Text className='mini'>实际尺码库存以配货时实盘核对为准</Text>
            </View>
          )
        })}
        {!items.length && <PageState empty emptyTitle='暂无库存资料' emptyDescription='点击右下角加号录入首批到货' />}
        <Button className='fab' onClick={() => setAdding(true)}>＋</Button>
        </>}
      </View>
      <BottomNav role='stall' active='inventory' />

      {adding && (
        <View className='sheet-mask' onClick={() => setAdding(false)}>
          <View className='sheet inventory-sheet' onClick={(event) => event.stopPropagation()}>
            <View className='row between'><Text className='title'>新增到货</Text><Text onClick={() => setAdding(false)}>×</Text></View>
            <View className='inventory-sheet__field row'><Text>款号</Text><Input value={form.productCode} onInput={(event) => setForm((current) => ({ ...current, productCode: event.detail.value }))} placeholder='搜索或填写款号' /></View>
            <View className='inventory-sheet__field row'><Text>数量</Text><Input type='number' value={form.quantity} onInput={(event) => setForm((current) => ({ ...current, quantity: event.detail.value }))} placeholder='本次到货总数' /></View>
            <View className='inventory-sheet__field row'><Text>花色</Text><Input value={form.colors} onInput={(event) => setForm((current) => ({ ...current, colors: event.detail.value }))} placeholder='如 黑色30、米白30' /></View>
            <View className='inventory-sheet__field row'><Text>来源</Text><Input value={form.note} onInput={(event) => setForm((current) => ({ ...current, note: event.detail.value }))} placeholder='如 合作加工厂' /></View>
            <View className='card inventory-sheet__preview'><View className='row between'><Text>当前参考库存</Text><Text>{selected?.referenceTotal ?? '—'}</Text></View><View className='row between'><Text>入库后参考总库存</Text><Text>{selected ? `${selected.referenceTotal} → ${selected.referenceTotal + incoming}` : '请先选择款号'}</Text></View></View>
            <Button className='primary-btn' onClick={confirmStock}>确认入库</Button>
          </View>
        </View>
      )}
    </>
  )
}
