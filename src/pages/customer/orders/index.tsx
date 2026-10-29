import { useCallback, useMemo, useRef, useState } from 'react'
import { View, Text, Button, Picker } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products, todayOrder, withLocalProductCovers } from '@/data/mock'
import { acknowledgeOrder, bootstrapApp, exportBill, isCloudReady, openExportedBill, requestErrorDetails } from '@/services/cloud'
import type { BillSummary, OrderSummary, ReturnSummary } from '@/types'
import { normaliseOrderItems } from '@/utils/cartLines'
import { relaunch } from '@/utils/navigation'
import { buildProductMap, findProduct, previewProductImages } from '@/utils/productImages'
import './index.scss'

export default function CustomerOrdersPage() {
  const confirming = useRef(false)
  const [acknowledging, setAcknowledging] = useState(false)
  const [tab, setTab] = useState<'all' | 'pending'>('all')
  const today = useMemo(() => {
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 10)
  }, [])
  const [date, setDate] = useState(today)
  const [catalog, setCatalog] = useState(runtimeConfig.demoMode ? products : [])
  const [orders, setOrders] = useState<OrderSummary[]>(runtimeConfig.demoMode ? [todayOrder] : [])
  const [returns, setReturns] = useState<ReturnSummary[]>(runtimeConfig.demoMode ? [{
    id: 'demo-return', orderId: todayOrder.id, date: todayOrder.date, status: 'pending', amount: 0,
    items: [{ productCode: '503', color: '米白', size: 'L', quantity: 2, unitPrice: 55, amount: 110 }]
  }] : [])
  const [bills, setBills] = useState<BillSummary[]>(runtimeConfig.demoMode ? [{
    id: 'demo-bill', merchantId: 'demo', date: todayOrder.date, original: todayOrder.total,
    adjustment: 0, returns: 0, discount: 0, payable: 1696, status: 'open', openingBalance: 1101,
    shipped: 705, corrections: 0, payments: 0, pendingPayments: 0, closingBalance: 1696
  }] : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [exporting, setExporting] = useState(false)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)

  const loadOrders = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await bootstrapApp()
      if (!result) return
      setCatalog(withLocalProductCovers(result.products))
      setOrders(normaliseOrderItems(result.orders))
      setReturns(result.returns)
      setBills(result.bills)
    } catch (error) {
      setCatalog([]); setOrders([]); setReturns([]); setBills([])
      setLoadError(requestErrorDetails(error, '订单加载失败'))
    } finally { setLoading(false) }
  }, [])

  useDidShow(loadOrders)

  const selectedOrders = useMemo(() => orders.filter((order) => order.date === date), [date, orders])
  const selectedReturns = useMemo(() => returns.filter((item) => item.date === date && item.items.length), [date, returns])
  const selectedBill = useMemo(() => bills.find((bill) => bill.date === date), [bills, date])
  const orderItems = selectedOrders.flatMap((order) => order.items)
  const orderQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0)
  const postedOrders = selectedOrders.filter((order) => order.accountingStatus !== 'unposted')
  const originalAmount = selectedBill?.original ?? postedOrders.reduce((sum, order) => sum + (order.original ?? order.total), 0)
  const payableAmount = selectedBill?.payable ?? postedOrders.reduce((sum, order) => sum + order.total, 0)
  const pendingOrders = selectedOrders.filter((order) => !['received', 'completed', 'cancelled'].includes(order.status))
  const productByCode = useMemo(() => buildProductMap(catalog), [catalog])
  const hasPendingReturn = selectedReturns.some((item) => !['confirmed', 'rejected'].includes(item.status))

  const acknowledge = async (order: OrderSummary, action: 'received' | 'issue') => {
    if (confirming.current) return
    confirming.current = true; setAcknowledging(true)
    try {
      const result = await Taro.showModal({ title: action === 'received' ? '确认收到商品' : '反馈数量或款式异常', content: action === 'received' ? '请核对实际收到的商品后确认。' : '确认后档口将核对数量及款式，原订单和账单记录会保留。' })
      if (!result.confirm) return
      if (isCloudReady()) await acknowledgeOrder(order.id, action, action === 'issue' ? '客户反馈数量或款式有误' : '')
      if (isCloudReady()) await loadOrders()
      else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: action === 'received' ? 'received' : 'exception', exceptionReason: action === 'issue' ? '客户反馈数量或款式有误' : undefined } : item))
      Taro.showToast({ title: action === 'received' ? '已确认收到' : '已提交异常，档口将复核', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '同步失败', icon: 'none' })
    } finally { confirming.current = false; setAcknowledging(false) }
  }

  const handleExport = async () => {
    if (exporting) return
    if (!isCloudReady()) {
      Taro.showToast({ title: '云开发配置后可生成 Excel', icon: 'none' })
      return
    }
    setExporting(true)
    Taro.showLoading({ title: '生成账单', mask: true })
    try {
      const result = await exportBill(date)
      Taro.hideLoading()
      await openExportedBill(result.fileId)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '账单导出失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
      setExporting(false)
    }
  }

  return (
    <>
      <AppHeader title='订单' />
      <View className='page orders-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadOrders} />
        {!loading && !loadError && <>
        <View className='tabs'>
          <View className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>全部</View>
          <View className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>待配货</View>
        </View>

        <Picker mode='date' value={date} onChange={(event) => setDate(event.detail.value)}>
          <View className='date-wheel row between'>
            <Text>‹</Text><View><Text className='date-wheel__label'>{date === today ? '今日' : date}</Text><Text className='mini'>{date} · 点按滚轮选择</Text></View><Text>›</Text>
          </View>
        </Picker>

        {tab === 'all' ? (
          <>
            {!!selectedOrders.length && <View className='card batch-overview'>
              <View className='row between'><View><Text className='title'>今日订货批次</Text><Text className='sub'>后续截图与文字继续追加到同一批次</Text></View><Text className='pill yellow'>修订 v{Math.max(...selectedOrders.map((item) => item.revision || 1))}</Text></View>
              <View className='batch-overview__actions'><Button className='ghost-btn' onClick={() => relaunch('/pages/customer/order/index')}>继续追加订货</Button><Button className='ghost-btn' onClick={() => Taro.showToast({ title: '打开本批次原始截图', icon: 'none' })}>查看原始截图</Button></View>
            </View>}
            <View className='card detail-card'>
              <View className='row between'><Text className='title'>{date === today ? '今日' : '当日'}订单详情</Text><Text className='sub'>{selectedOrders.length}单 · {orderItems.length}款 · {orderQuantity}件</Text></View>
              {orderItems.map((item) => {
                const product = findProduct(productByCode, item.productCode)
                return <View key={item.id} className='detail-item'>
                  <ProductImage className='detail-item__image' code={item.productCode} images={product?.images} onClick={() => previewProductImages(product?.images)} />
                  <View className='grow'><Text className='detail-item__name'>{item.productCode} {item.name}</Text><Text className='sub'>{item.color} · {item.size}码 · {item.quantity}件</Text></View>
                  <View className='detail-item__price'>
                    {item.originalUnitPrice && item.originalUnitPrice !== item.unitPrice && <Text className='detail-item__old-price'>¥{item.originalUnitPrice}</Text>}
                    <Text>¥{item.unitPrice}×{item.quantity}</Text>
                    <Text className='detail-item__total'>¥{(item.unitPrice * item.quantity).toFixed(2)}</Text>
                  </View>
                </View>
              })}
              {!orderItems.length && <Text className='empty-hint'>该日期暂无订单</Text>}
              {selectedOrders.some((order) => order.accountingStatus === 'unposted') && <Text className='mini'>未实配订单金额仅为预估，档口确认实配后才计入账款。</Text>}
              {selectedOrders.filter((order) => order.packingNote).map((order) => <View key={`packing-${order.id}`} className='mini'>实配说明：{order.packingNote}</View>)}
            </View>

            <View className='card detail-card'>
              <View className='row between'><Text className='title'>{date === today ? '今日' : '当日'}退单详情</Text><Text className={`pill ${hasPendingReturn ? 'yellow' : 'green'}`}>{hasPendingReturn ? '核对中' : '已核算'}</Text></View>
              {selectedReturns.flatMap((returned) => returned.items.map((item, index) => {
                const product = findProduct(productByCode, item.productCode)
                return <View className='detail-item' key={`${returned.id}-${item.productCode}-${index}`}>
                  <ProductImage className='detail-item__image' code={item.productCode} images={product?.images} onClick={() => previewProductImages(product?.images)} />
                  <View className='grow'><Text className='detail-item__name'>{item.productCode} 退货</Text><Text className='sub'>{item.color} · {item.size}码 · 退货{item.quantity}件</Text><Text className='sub'>原订单 {returned.orderId}</Text></View>
                  <View className='detail-item__price'><Text>{returned.status === 'confirmed' ? `-¥${item.amount}` : '暂不抵扣'}</Text><Text className='mini'>{returned.status === 'photo_review' ? '照片待核对' : returned.status === 'awaiting_goods' ? '待实物送回' : returned.status === 'inspection' ? '实物清点中' : returned.status === 'exception' ? '异常核对' : '已确认'}</Text></View>
                </View>
              }))}
              {!selectedReturns.length && <Text className='empty-hint'>该日期暂无退单</Text>}
              {hasPendingReturn && <Text className='mini'>照片通过只代表待送回；档口实收确认后才抵扣并回库。</Text>}
            </View>

            <View className='card ledger-card'>
              <Text className='title ledger-card__heading'>账款汇总</Text>
              <View className='row between'><Text>上期结欠</Text><Text>¥{(selectedBill?.openingBalance || 0).toFixed(2)}</Text></View>
              <View className='divider' />
              <View className='row between'><Text>今日实际出货</Text><Text>+¥{(selectedBill?.shipped ?? originalAmount).toFixed(2)}</Text></View>
              {Boolean(selectedBill?.adjustment) && <><View className='divider' /><View className='row between'><Text>价格调整</Text><Text>{selectedBill!.adjustment > 0 ? '-' : '+'}¥{Math.abs(selectedBill!.adjustment).toFixed(2)}</Text></View></>}
              <View className='divider' />
              <View className='row between'><Text>{hasPendingReturn ? '待核算退货' : '已确认退货'}</Text><Text className={hasPendingReturn ? 'sub' : ''}>{hasPendingReturn ? '暂不抵扣' : `-¥${(selectedBill?.returns || 0).toFixed(2)}`}</Text></View>
              {Boolean(selectedBill?.discount) && <><View className='divider' /><View className='row between'><Text>优惠减免</Text><Text>-¥{selectedBill!.discount.toFixed(2)}</Text></View></>}
              <View className='divider' />
              <View className='row between'><Text>已确认收款</Text><Text>-¥{(selectedBill?.payments || 0).toFixed(2)}</Text></View>
              {!!selectedBill?.pendingPayments && <><View className='divider' /><View className='row between'><Text>待确认转账</Text><Text className='sub'>¥{selectedBill.pendingPayments.toFixed(2)}（未抵扣）</Text></View></>}
              <View className='divider' />
              <View className='row between'><Text>本期结欠</Text><Text className='title'>¥{(selectedBill?.closingBalance ?? payableAmount).toFixed(2)}</Text></View>
            </View>

            <View className='card row between export-card'>
              <View><Text className='title export-card__title'>导出账单</Text><Text className='sub'>自动沿用当前选择日期</Text></View>
              <Button className='export-card__button' disabled={exporting} loading={exporting} onClick={handleExport}>{exporting ? '处理中' : '导出 Excel'}</Button>
            </View>
          </>
        ) : (
          <>
            {pendingOrders.map((order) => (
              <View className='card pending-order' key={order.id}>
                <View className='row between'><View><Text className='title'>今日批次</Text><Text className='sub'>已追加 {order.appendCount || 1} 次 · 修订 v{order.revision || 1}</Text></View><Text className='pill yellow'>{order.status === 'pending' ? '等待配货' : order.status === 'picking' ? '配货中' : order.status === 'awaiting_pickup' ? '待取货' : order.status === 'in_transit' ? '运输中' : order.status === 'exception' ? '异常处理中' : '已配齐'}</Text></View>
                {order.status === 'picking' && <View className='progress'><View className='progress__value' /></View>}
                {order.items.map((item) => <View className='pending-order__line' key={item.id}><Text>{item.productCode} · {item.color} · {item.size}码</Text><Text>{item.quantity}件</Text></View>)}
                <View className='pending-order__actions'><Button disabled={acknowledging} className='ghost-btn' onClick={() => acknowledge(order, 'issue')}>数量有误</Button>{['awaiting_pickup', 'in_transit', 'packed', 'picked'].includes(order.status) && <Button disabled={acknowledging} className='primary-btn' onClick={() => acknowledge(order, 'received')}>确认收到</Button>}</View>
              </View>
            ))}
            {!pendingOrders.length && <View className='card empty-hint'>该日期没有待配货订单</View>}
          </>
        )}
        </>}
      </View>
      <BottomNav role='customer' active='orders' />
    </>
  )
}
