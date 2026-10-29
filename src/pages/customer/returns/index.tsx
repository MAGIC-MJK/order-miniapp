import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Button, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products, todayOrder } from '@/data/mock'
import { bootstrapApp, isCloudReady, requestErrorDetails, submitReturn, uploadFiles } from '@/services/cloud'
import type { CartItem, OrderSummary, ReturnItem, ReturnSummary } from '@/types'
import { buildProductMap, findProduct } from '@/utils/productImages'
import './index.scss'

const demoReturn: ReturnSummary = {
  id: 'return-demo', orderId: todayOrder.id, date: todayOrder.date, status: 'awaiting_goods', amount: 0,
  merchantName: '示例客户甲', photos: [],
  items: [{ productCode: '607', color: '白色', size: 'XL', quantity: 2, unitPrice: 65, amount: 130 }]
}

const statusSteps = [
  ['photo_review', '照片核对'], ['awaiting_goods', '待送回'], ['inspection', '实物清点'], ['confirmed', '抵扣回库']
] as const

export default function CustomerReturnsPage() {
  const [tab, setTab] = useState<'apply' | 'progress'>('apply')
  const [photos, setPhotos] = useState<string[]>([])
  const [selected, setSelected] = useState<ReturnItem | null>(runtimeConfig.demoMode ? { productCode: '607', color: '白色', size: 'XL', quantity: 1, unitPrice: 65, amount: 65 } : null)
  const [selectedOrderId, setSelectedOrderId] = useState(runtimeConfig.demoMode ? todayOrder.id : '')
  const [orders, setOrders] = useState<OrderSummary[]>(runtimeConfig.demoMode ? [todayOrder] : [])
  const [returns, setReturns] = useState<ReturnSummary[]>(runtimeConfig.demoMode ? [demoReturn] : [])
  const [catalog, setCatalog] = useState(runtimeConfig.demoMode ? products : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const productByCode = useMemo(() => buildProductMap(catalog), [catalog])
  const orderLines = useMemo(() => orders.filter((order) => order.status !== 'cancelled').flatMap((order) => order.items.map((item) => ({ orderId: order.id, item }))), [orders])

  const loadReturns = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try {
      const result = await bootstrapApp()
      if (!result) return
      const returnableOrders = result.orders.filter((order) => order.accountingStatus !== 'unposted' && (['packed', 'picked', 'awaiting_pickup', 'in_transit', 'received', 'completed'].includes(order.status) || order.status === 'exception' && !['pending', 'picking'].includes(order.exceptionFromStatus || 'picking'))).map((order) => ({ ...order, items: order.items.filter((item) => item.quantity > 0) }))
      setOrders(returnableOrders); setReturns(result.returns); setCatalog(result.products)
      const first = returnableOrders.flatMap((order) => order.items.map((item) => ({ orderId: order.id, item })))[0]
      if (first) selectLine(first.orderId, first.item)
    } catch (error) {
      setOrders([]); setReturns([]); setCatalog([]); setSelected(null); setSelectedOrderId('')
      setLoadError(requestErrorDetails(error, '退货资料加载失败'))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadReturns() }, [loadReturns])

  const choosePhotos = async () => {
    const remaining = 6 - photos.length
    if (!remaining) return Taro.showToast({ title: '最多上传 6 张照片', icon: 'none' })
    try {
      const result = await Taro.chooseImage({ count: remaining, sourceType: ['camera', 'album'], sizeType: ['compressed'] })
      setPhotos((current) => [...current, ...result.tempFilePaths].slice(0, 6))
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      if (/cancel/i.test(message)) return
      Taro.showToast({ title: /auth|permission|deny/i.test(message) ? '请在微信设置中允许使用相机或相册' : '打开相机/相册失败，请重试', icon: 'none' })
    }
  }

  const selectLine = (orderId: string, item: CartItem) => {
    setSelectedOrderId(orderId)
    setSelected({ productId: item.productId, productCode: item.productCode, color: item.color, size: item.size, quantity: 1, unitPrice: item.unitPrice, amount: item.unitPrice })
  }

  const submit = async () => {
    if (!photos.length) return Taro.showToast({ title: '请先拍摄退货照片', icon: 'none' })
    if (!selected) return Taro.showToast({ title: '请选择原订单商品', icon: 'none' })
    const sourceOrder = orderLines.find((line) => line.orderId === selectedOrderId && line.item.productCode === selected.productCode && line.item.color === selected.color && line.item.size === selected.size)
    if (!sourceOrder) return Taro.showToast({ title: '未找到对应原订单', icon: 'none' })
    Taro.showLoading({ title: '正在提交', mask: true })
    try {
      let created: ReturnSummary
      if (isCloudReady()) {
        const fileIds = await uploadFiles(photos, 'returns')
        created = await submitReturn({ orderId: sourceOrder.orderId, items: [selected], fileIds })
      } else {
        created = { id: `return-${Date.now()}`, orderId: todayOrder.id, date: todayOrder.date, status: 'photo_review', amount: 0, photos, items: [selected] }
      }
      setReturns((current) => [created, ...current])
      setTab('progress')
      Taro.showToast({ title: '已提交照片，暂未抵扣', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '退货提交失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  return <>
    <AppHeader title='退货' subtitle='示例档口' />
    <View className='page returns-page'>
      <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadReturns} />
      {!loading && !loadError && <>
      <View className='tabs'><View className={`tab ${tab === 'apply' ? 'active' : ''}`} onClick={() => setTab('apply')}>申请退货</View><View className={`tab ${tab === 'progress' ? 'active' : ''}`} onClick={() => setTab('progress')}>退货进度</View></View>
      {tab === 'apply' ? <>
        <View className='card return-guide'><Text className='title'>先拍照，再送回</Text><Text className='sub'>照片核对通过不代表已抵扣；档口收到实物并清点后才抵扣账单，可售商品才回库存。</Text></View>
        <View className='card'>
          <Text className='title'>选择原订单商品</Text>
          {orderLines.slice(0, 12).map(({ orderId, item }) => <View className={`return-line ${selectedOrderId === orderId && selected?.productCode === item.productCode && selected?.color === item.color && selected?.size === item.size ? 'active' : ''}`} key={`${orderId}-${item.id}`} onClick={() => selectLine(orderId, item)}>
            <ProductImage className='return-line__image' code={item.productCode} images={findProduct(productByCode, item.productCode)?.images} />
            <View className='grow'><Text>{item.productCode} · {item.color}</Text><Text className='sub'>{item.size}码 · 原成交价 ¥{item.unitPrice}</Text></View><Text>选取</Text>
          </View>)}
          {selected && <View className='return-quantity row between'><Text>退货数量</Text><View className='row'><Text className='return-step' onClick={() => setSelected((item) => item ? ({ ...item, quantity: Math.max(1, item.quantity - 1), amount: Math.max(1, item.quantity - 1) * item.unitPrice }) : item)}>−</Text><Text>{selected.quantity}</Text><Text className='return-step' onClick={() => setSelected((item) => item ? ({ ...item, quantity: item.quantity + 1, amount: (item.quantity + 1) * item.unitPrice }) : item)}>＋</Text></View></View>}
          {!orderLines.length && <PageState empty emptyTitle='暂无可退商品' emptyDescription='完成订货后，可以从原订单中选择商品申请退货' />}
        </View>
        <View className='card'>
          <View className='row between'><View><Text className='title'>退货照片</Text><Text className='sub'>拍清款式、数量与包装标记</Text></View><Text>{photos.length}/6</Text></View>
          <View className='return-photos'>{photos.map((photo) => <Image key={photo} src={photo} mode='aspectFill' onClick={() => Taro.previewImage({ urls: photos, current: photo })} />)}<Button className='return-photo-add' onClick={choosePhotos}><Text>＋</Text><Text className='mini'>拍照/上传</Text></Button></View>
        </View>
        <Button className='primary-btn' onClick={submit}>提交照片核对</Button>
      </> : returns.map((item) => {
        const currentIndex = Math.max(0, statusSteps.findIndex(([key]) => key === item.status))
        return <View className='card return-progress' key={item.id}>
          <View className='row between'><View><Text className='title'>退货单 {item.id.slice(-8)}</Text><Text className='sub'>{item.date} · 原批次 {item.orderId}</Text></View><Text className={`pill ${item.status === 'confirmed' ? 'green' : 'yellow'}`}>{item.status === 'confirmed' ? '已抵扣' : '处理中'}</Text></View>
          <View className='return-progress__steps'>{statusSteps.map(([key, label], index) => <View className={index <= currentIndex ? 'active' : ''} key={key}><Text className='return-progress__dot'>{index < currentIndex ? '✓' : index + 1}</Text><Text>{label}</Text></View>)}</View>
          {item.items.map((line) => <View className='return-progress__line' key={`${line.productCode}-${line.color}-${line.size}`}><Text>{line.productCode} · {line.color} · {line.size}码</Text><Text>{line.quantity}件</Text></View>)}
          <Text className='mini'>{item.status === 'awaiting_goods' ? '照片已通过，请将实物送回示例档口。' : item.status === 'confirmed' ? `实收确认，已抵扣 ¥${item.amount.toFixed(2)} 并按可售数量回库。` : '当前金额不计入账单抵扣。'}</Text>
        </View>
      })}
      </>}
    </View>
    <BottomNav role='customer' active='returns' />
  </>
}
