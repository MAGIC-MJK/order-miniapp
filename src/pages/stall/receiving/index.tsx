import { useCallback, useMemo, useRef, useState } from 'react'
import { View, Text, Button, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products, todayOrder, withLocalProductCovers } from '@/data/mock'
import { bootstrapApp, isCloudReady, requestErrorDetails, transitionOrder } from '@/services/cloud'
import type { BatchEvent, OrderStatus, OrderSummary } from '@/types'
import { normaliseOrderItems } from '@/utils/cartLines'
import { buildProductMap, findProduct, previewProductImages } from '@/utils/productImages'
import './index.scss'

type ReceivingTab = 'recognition' | 'pending' | 'picking' | 'handover' | 'received' | 'exception'

const demoEvents = todayOrder.events || []
const demoOrders: OrderSummary[] = [
  { ...todayOrder, id: `${todayOrder.id}-1`, status: 'pending', merchantName: '示例客户甲' },
  { ...todayOrder, id: `${todayOrder.id}-2`, status: 'picking', merchantName: '王姐服饰' },
  { ...todayOrder, id: `${todayOrder.id}-3`, status: 'awaiting_pickup', merchantName: '示例客户乙商行', events: [...demoEvents, { id: 'handover', type: 'handover', title: '配货完成，等待客户取货', createdAt: '14:20', operator: 'stall' }] },
  { ...todayOrder, id: `${todayOrder.id}-4`, status: 'received', merchantName: '示例客户丙裤业', accountingStatus: 'posted', events: [...demoEvents, { id: 'received', type: 'received', title: '客户确认收到 17 件', createdAt: '17:46', operator: 'customer' }] },
  { ...todayOrder, id: `${todayOrder.id}-5`, status: 'exception', merchantName: '佳佳服饰', exceptionReason: '客户反馈少 1 件，等待档口复核' }
]

const tabLabels: Array<[ReceivingTab, string]> = [
  ['recognition', '待识别'],
  ['pending', '待配货'],
  ['picking', '配货中'],
  ['handover', '待取/运输'],
  ['received', '已确认'],
  ['exception', '异常']
]

function belongsToTab(status: OrderStatus, tab: ReceivingTab) {
  if (tab === 'handover') return ['packed', 'awaiting_pickup', 'in_transit', 'picked'].includes(status)
  if (tab === 'received') return ['received', 'completed'].includes(status)
  return status === tab
}

function statusLabel(status: OrderStatus) {
  return ({
    pending: '待配货', picking: '配货中', packed: '已配齐', picked: '已配齐', awaiting_pickup: '待取货',
    in_transit: '运输中', received: '客户已确认', exception: '异常待处理', completed: '已完成', cancelled: '已取消'
  } as Record<OrderStatus, string>)[status]
}

export default function StallReceivingPage() {
  const syncing = useRef(false)
  const [busy, setBusy] = useState(false)
  const [packedQuantities, setPackedQuantities] = useState<Record<string, string>>({})
  const [packingNotes, setPackingNotes] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<ReceivingTab>('pending')
  const [orders, setOrders] = useState<OrderSummary[]>(runtimeConfig.demoMode ? demoOrders : [])
  const [catalog, setCatalog] = useState(runtimeConfig.demoMode ? products : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const recognitionCount = runtimeConfig.demoMode ? 2 : 0

  const loadOrders = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try {
      const result = await bootstrapApp()
      if (!result) return
      setCatalog(withLocalProductCovers(result.products))
      setOrders(normaliseOrderItems(result.orders).filter((item) => item.status !== 'cancelled'))
    } catch (error) {
      setOrders([]); setCatalog([]); setLoadError(requestErrorDetails(error, '订单加载失败'))
    } finally { setLoading(false) }
  }, [])
  useDidShow(loadOrders)

  const visibleOrders = useMemo(() => orders.filter((order) => belongsToTab(order.status, tab)), [orders, tab])
  const productByCode = useMemo(() => buildProductMap(catalog), [catalog])
  const totalPending = orders.filter((item) => item.status === 'pending').reduce((sum, order) => sum + order.items.reduce((total, item) => total + item.quantity, 0), 0)

  const moveOrder = async (order: OrderSummary, nextStatus: OrderStatus) => {
    if (syncing.current) return
    syncing.current = true; setBusy(true)
    try {
      const packedItems = nextStatus === 'packed' && order.status !== 'exception' ? order.items.map((item) => {
        const value = packedQuantities[`${order.id}:${item.id}`] ?? String(item.quantity)
        return { lineId: item.id, quantity: /^\d+$/.test(value) ? Number(value) : NaN }
      }) : undefined
      if (packedItems?.some((item, index) => !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > order.items[index].quantity)) throw new Error('实配数量须为 0 到订货数量之间的整数')
      let note = (packingNotes[order.id] || '').trim()
      if (packedItems && packedItems.every((item) => item.quantity === 0)) throw new Error('全部缺货请登记异常，不要确认出库')
      if (packedItems?.some((item, index) => item.quantity !== order.items[index].quantity) && !note) throw new Error('少配或缺货时请填写配货说明')
      if (nextStatus === 'exception' || order.status === 'exception' || nextStatus === 'received') {
        if (!note) throw new Error(nextStatus === 'received' ? '请先填写取货人或收货确认依据' : '请先填写异常原因或处理说明')
        const result = await Taro.showModal({ title: nextStatus === 'exception' ? '登记异常' : order.status === 'exception' ? '异常核对完成' : '档口代确认收货', content: note })
        if (!result.confirm) return
      }
      if (packedItems) {
        const quantity = packedItems.reduce((sum, item) => sum + item.quantity, 0)
        const amount = packedItems.reduce((sum, item, index) => sum + item.quantity * order.items[index].unitPrice, 0)
        const result = await Taro.showModal({ title: '确认实配并入账', content: `本次实配 ${quantity} 件，商品金额 ¥${amount.toFixed(2)}。确认后出库并按实配核算账单；未配数量不计费。` })
        if (!result.confirm) return
      }
      Taro.showLoading({ title: '正在同步', mask: true })
      if (isCloudReady()) {
        await transitionOrder(order.id, nextStatus, packedItems, { note, revision: order.revision })
        await loadOrders()
        setPackedQuantities({}); setPackingNotes({})
      } else {
        const eventType: BatchEvent['type'] = nextStatus === 'picking' ? 'picking' : nextStatus === 'received' ? 'received' : nextStatus === 'exception' ? 'exception' : nextStatus === 'packed' ? 'packed' : 'handover'
        setOrders((current) => current.map((item) => item.id === order.id ? {
          ...item,
          status: nextStatus,
          accountingStatus: nextStatus === 'packed' ? 'posted' : item.accountingStatus,
          events: [...(item.events || []), { id: `event-${Date.now()}`, type: eventType, title: statusLabel(nextStatus), createdAt: '刚刚', operator: 'stall' }]
        } : item))
      }
      setTab(nextStatus === 'picking' ? 'picking' : nextStatus === 'received' ? 'received' : nextStatus === 'exception' ? 'exception' : 'handover')
      Taro.showToast({ title: `已更新为${statusLabel(nextStatus)}`, icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '状态同步失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
      syncing.current = false; setBusy(false)
    }
  }

  return (
    <>
      <AppHeader title='接单' subtitle='示例档口' />
      <View className='page receiving-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadOrders} />
        {!loading && !loadError && <>
        <View className='oriental-hero receiving-overview'>
          <View className='oriental-hero__copy'>
            <Text className='oriental-hero__eyebrow'>客 户 每 日 批 次</Text>
            <Text className='oriental-hero__title'>待配货 {totalPending} 件</Text>
            <Text className='oriental-hero__sub'>追加合并到当日批次 · 出货、收货和入账分别记录</Text>
          </View>
        </View>

        <View className='receiving-tabs'>
          {tabLabels.map(([key, label]) => {
            const count = key === 'recognition' ? recognitionCount : orders.filter((order) => belongsToTab(order.status, key)).length
            return <View key={key} className={`receiving-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}><Text>{label}</Text><Text className='receiving-tab__count'>{count}</Text></View>
          })}
        </View>

        {tab === 'recognition' && recognitionCount > 0 && (
          <View className='card recognition-card'>
            <View className='row between'><Text className='title'>示例客户甲 · 今日批次</Text><Text className='pill yellow'>2 条待确认</Text></View>
            <Text className='sub recognition-card__copy'>平台截图与文字已识别，601 与 601-1、666 与薄666 保持分开，确认后再加入今日批次。</Text>
            <Button className='primary-btn' onClick={() => Taro.showToast({ title: '进入识别结果核对', icon: 'none' })}>核对识别结果</Button>
          </View>
        )}

        {tab !== 'recognition' && visibleOrders.map((order) => {
          const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0)
          return (
            <View className={`card receiving-card ${order.status === 'exception' ? 'is-exception' : ''}`} key={order.id}>
              <View className='row between'>
                <View><Text className='title'>{order.merchantName}</Text><Text className='sub'>今日批次 · 已追加 {order.appendCount || 1} 次 · 修订 v{order.revision || 1}</Text></View>
                <Text className={`pill ${['received', 'completed'].includes(order.status) ? 'green' : 'yellow'}`}>{statusLabel(order.status)}</Text>
              </View>
              <View className='receiving-summary'>
                <Text>{quantity}件 · {order.accountingStatus === 'unposted' ? '预计' : ''}¥{order.total.toFixed(2)}</Text>
                <Text className={order.accountingStatus === 'posted' ? 'green' : 'sub'}>{order.accountingStatus === 'posted' ? '已按实配入账' : '尚未按实配入账'}</Text>
              </View>

              {order.items.map((item) => (
                <View className='receiving-line' key={item.id}>
                  <ProductImage className='receiving-line__image' code={item.productCode} images={findProduct(productByCode, item.productCode)?.images} onClick={() => previewProductImages(findProduct(productByCode, item.productCode)?.images)} />
                  <View className='grow'><Text>{item.productCode} · {item.color}</Text><Text className='sub'>{item.size}码 · ¥{item.unitPrice}</Text></View>
                  {order.status === 'picking' ? <View className='receiving-quantity'><Text className='mini'>订 {item.quantity} 件 · 实配</Text><Input type='number' value={packedQuantities[`${order.id}:${item.id}`] ?? String(item.quantity)} disabled={busy} onInput={(event) => setPackedQuantities((current) => ({ ...current, [`${order.id}:${item.id}`]: event.detail.value }))} /></View> : <Text>{item.quantity}件</Text>}
                </View>
              ))}

              {order.exceptionReason && <View className='receiving-alert'>异常：{order.exceptionReason}</View>}
              {order.packingNote && <View className='receiving-alert'>配货说明：{order.packingNote}</View>}
              {!!order.requestedItems?.length && <Text className='mini'>原订 {order.requestedItems.reduce((sum, item) => sum + item.quantity, 0)} 件 · 实配 {quantity} 件，未配部分不计费。</Text>}
              {order.requestedItems?.filter((original) => original.quantity !== (order.items.find((item) => item.id === original.id)?.quantity || 0)).map((original) => <View className='mini' key={`short-${original.id}`}>{original.productCode} · {original.color} · {original.size}码：原订 {original.quantity}，实配 {order.items.find((item) => item.id === original.id)?.quantity || 0}</View>)}
              {!!order.events?.length && <View className='batch-history'>
                <Text className='mini batch-history__title'>批次流水（原记录不覆盖）</Text>
                {order.events.slice(-3).map((event) => <View className='batch-history__line' key={event.id}><Text className='batch-history__time'>{event.createdAt.includes('T') ? new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : event.createdAt}</Text><View><Text>{event.title}</Text>{event.detail && <Text className='sub'>{event.detail}</Text>}</View></View>)}
              </View>}

              {!['received', 'completed', 'cancelled'].includes(order.status) && <Input className='receiving-note' value={packingNotes[order.id] || ''} disabled={busy} maxlength={300} placeholder={order.status === 'exception' ? '填写异常核对结果与处理说明' : ['awaiting_pickup', 'in_transit'].includes(order.status) ? '代确认时填写取货人或收货确认依据' : '缺货、少配、错款等请填写说明'} onInput={(event) => setPackingNotes((current) => ({ ...current, [order.id]: event.detail.value }))} />}
              {order.status === 'pending' && <Button disabled={busy} className='primary-btn' onClick={() => moveOrder(order, 'picking')}>开始配货</Button>}
              {order.status === 'picking' && <Button disabled={busy} className='primary-btn' onClick={() => moveOrder(order, 'packed')}>保存实配并入账</Button>}
              {['packed', 'picked'].includes(order.status) && <View className='receiving-actions'><Button disabled={busy} className='primary-btn' onClick={() => moveOrder(order, 'awaiting_pickup')}>标记等待取货</Button><Button disabled={busy} className='ghost-btn' onClick={() => moveOrder(order, 'in_transit')}>确认发出</Button></View>}
              {['awaiting_pickup', 'in_transit'].includes(order.status) && <Button disabled={busy} className='ghost-btn' onClick={() => moveOrder(order, 'received')}>档口代确认收货</Button>}
              {['pending', 'picking', 'packed', 'picked', 'awaiting_pickup', 'in_transit'].includes(order.status) && <Button disabled={busy} className='ghost-btn' onClick={() => moveOrder(order, 'exception')}>缺货 / 错款 / 其他异常</Button>}
              {order.status === 'exception' && <Button disabled={busy} className='primary-btn' onClick={() => moveOrder(order, ['pending', 'picking'].includes(order.exceptionFromStatus || '') ? 'picking' : order.exceptionFromStatus || (order.accountingStatus === 'unposted' ? 'picking' : 'packed'))}>核对完成，恢复处理</Button>}
            </View>
          )
        })}
        {tab !== 'recognition' && !visibleOrders.length && <View className='card receiving-empty'>当前没有{tabLabels.find(([key]) => key === tab)?.[1]}批次</View>}
        {tab === 'recognition' && recognitionCount === 0 && <PageState empty emptyTitle='暂无待识别订单' emptyDescription='客户上传的截图或链接订单会显示在这里' />}
        </>}
      </View>
      <BottomNav role='stall' active='receiving' />
    </>
  )
}
