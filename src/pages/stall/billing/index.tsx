import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Button, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products, todayOrder, withLocalProductCovers } from '@/data/mock'
import { adjustBill, bootstrapApp, isCloudReady, requestErrorDetails, transitionReturn } from '@/services/cloud'
import type { BillSummary, MerchantProfile, OrderSummary, Product, ReturnSummary } from '@/types'
import { normaliseOrderItems } from '@/utils/cartLines'
import { buildProductMap, findProduct, previewProductImages } from '@/utils/productImages'
import './index.scss'

const filters = ['今日已报', '今日未报', '7日内报', '7日未报'] as const
type BillingFilter = typeof filters[number]

function localDateKey() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export default function StallBillingPage() {
  const today = useMemo(localDateKey, [])
  const [filter, setFilter] = useState<BillingFilter>(filters[0])
  const [keyword, setKeyword] = useState('')
  const [detail, setDetail] = useState(false)
  const [orders, setOrders] = useState<OrderSummary[]>(runtimeConfig.demoMode ? [{ ...todayOrder, merchantId: 'demo-customer' }] : [])
  const [bills, setBills] = useState<BillSummary[]>(runtimeConfig.demoMode ? [{
    id: 'demo-bill', merchantId: 'demo-customer', date: todayOrder.date, original: todayOrder.total,
    adjustment: 0, returns: 0, discount: 0, payable: 1696, status: 'open', openingBalance: 1101,
    shipped: todayOrder.total, payments: 0, pendingPayments: 300, closingBalance: 1696
  }] : [])
  const [returnRecords, setReturnRecords] = useState<ReturnSummary[]>(runtimeConfig.demoMode ? [{
    id: 'demo-return-review', orderId: todayOrder.id, merchantId: 'demo-customer', merchantName: '示例客户甲',
    date: todayOrder.date, status: 'awaiting_goods', amount: 0, photos: [],
    items: [{ productCode: '607', color: '白色', size: 'XL', quantity: 2, unitPrice: 65, amount: 130 }]
  }] : [])
  const [customers, setCustomers] = useState<MerchantProfile[]>(runtimeConfig.demoMode ? [
    { id: 'demo-customer', name: '示例客户甲' },
    { id: 'demo-wang', name: '王姐服饰' }
  ] : [])
  const [catalog, setCatalog] = useState<Product[]>(runtimeConfig.demoMode ? products : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<MerchantProfile | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderSummary | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [returnForm, setReturnForm] = useState({ productCode: '', size: '', color: '', quantity: '0' })
  const [discount, setDiscount] = useState('0')

  const loadBilling = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try {
      const result = await bootstrapApp()
      if (!result) return
      if (result.user.canViewBills === false) throw new Error('账单权限未开通，请联系主管理员授权')
      setOrders(normaliseOrderItems(result.orders))
      setCatalog(withLocalProductCovers(result.products))
      setBills(result.bills)
      setReturnRecords(result.returns)
      setCustomers(result.customers || [])
    } catch (error) {
      setOrders([]); setCatalog([]); setBills([]); setReturnRecords([]); setCustomers([])
      setLoadError(requestErrorDetails(error, '账单加载失败'))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadBilling() }, [loadBilling])

  const customerRows = useMemo(() => {
    const sevenDaysAgo = new Date(`${today}T00:00:00`)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    return customers.map((customer) => {
      const customerOrders = orders.filter((order) => order.merchantId === customer.id)
      const todayOrders = customerOrders.filter((order) => order.date === today)
      const recentOrders = customerOrders.filter((order) => new Date(`${order.date}T00:00:00`) >= sevenDaysAgo)
      const todayBill = bills.find((bill) => bill.merchantId === customer.id && bill.date === today)
      const outstanding = bills.filter((bill) => bill.merchantId === customer.id && bill.status === 'open').reduce((sum, bill) => sum + bill.payable, 0)
      return { customer, customerOrders, todayOrders, recentOrders, todayBill, outstanding }
    }).filter((row) => {
      const query = keyword.trim().toLowerCase()
      if (query && !`${row.customer.name}${row.customer.contactName || ''}${row.customer.phone || ''}`.toLowerCase().includes(query)) return false
      if (filter === '今日已报') return row.todayOrders.length > 0
      if (filter === '今日未报') return row.todayOrders.length === 0
      if (filter === '7日内报') return row.recentOrders.length > 0
      return row.recentOrders.length === 0
    })
  }, [bills, customers, filter, keyword, orders, today])

  const todayAmount = bills.filter((bill) => bill.date === today).reduce((sum, bill) => sum + bill.payable, 0)
  const outstandingAmount = bills.filter((bill) => bill.status === 'open').reduce((sum, bill) => sum + bill.payable, 0)
  const linePrices = selectedOrder?.items.map((item) => prices[item.id] ?? item.unitPrice) || []
  const productByCode = useMemo(() => buildProductMap(catalog), [catalog])
  const adjustedTotal = selectedOrder?.items.reduce((sum, item, index) => sum + linePrices[index] * item.quantity, 0) || 0
  const returnLine = selectedOrder?.items.find((item) => item.productCode === returnForm.productCode)
  const returnPrice = returnLine ? prices[returnLine.id] ?? returnLine.unitPrice : 0
  const returnQuantity = Math.max(0, Number.parseInt(returnForm.quantity, 10) || 0)
  const selectedReturn = selectedOrder ? returnRecords.find((item) => item.orderId === selectedOrder.id) : undefined
  const proposedReturnAmount = returnPrice * returnQuantity
  const returnAmount = selectedReturn?.status === 'confirmed' ? selectedReturn.amount : 0
  const discountAmount = Math.max(0, Number(discount) || 0)
  const originalAmount = selectedOrder?.original ?? selectedOrder?.items.reduce((sum, item) => sum + (item.originalUnitPrice || item.unitPrice) * item.quantity, 0) ?? 0
  const adjustmentAmount = originalAmount - adjustedTotal
  const selectedBill = selectedOrder ? bills.find((bill) => bill.merchantId === selectedOrder.merchantId && bill.date === selectedOrder.date) : undefined
  const finalAmount = Math.max(0, (selectedBill?.openingBalance || 0) + adjustedTotal - returnAmount - discountAmount - (selectedBill?.payments || 0))

  const openDetail = (customer: MerchantProfile, customerOrders: OrderSummary[]) => {
    const order = customerOrders.find((item) => item.date === today) || customerOrders[0]
    if (!order) {
      Taro.showToast({ title: '该客户暂无订单详情', icon: 'none' })
      return
    }
    setSelectedCustomer(customer)
    setSelectedOrder(order)
    setPrices(Object.fromEntries(order.items.map((item) => [item.id, item.unitPrice])))
    const returnRecord = returnRecords.find((item) => item.orderId === order.id)
    const firstReturn = returnRecord?.items[0] || order.returnItems?.[0]
    const first = order.items[0]
    setReturnForm({
      productCode: firstReturn?.productCode || first?.productCode || '',
      size: firstReturn?.size || first?.size || '',
      color: firstReturn?.color || first?.color || '',
      quantity: String(firstReturn?.quantity || 0)
    })
    setDiscount(String(order.discount || 0))
    setDetail(true)
  }

  const confirmPhysicalReturn = async () => {
    if (!selectedReturn) return
    Taro.showLoading({ title: '确认实收', mask: true })
    try {
      let next: ReturnSummary = { ...selectedReturn, status: 'confirmed', amount: proposedReturnAmount, receivedQuantity: returnQuantity, inventoryPosted: true }
      if (isCloudReady()) next = await transitionReturn(selectedReturn.id, 'confirmed', { receivedQuantity: returnQuantity })
      setReturnRecords((current) => current.map((item) => item.id === selectedReturn.id ? next : item))
      Taro.showToast({ title: '已抵扣并按可售数量回库', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '实收确认失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const stepPrice = (lineId: string, amount: number) => {
    setPrices((current) => ({ ...current, [lineId]: Math.max(0.01, Number(((current[lineId] || 0) + amount).toFixed(2))) }))
  }

  const chooseReturnLine = (item: OrderSummary['items'][number]) => {
    const existing = selectedOrder?.returnItems?.find((returned) =>
      returned.productCode === item.productCode && returned.color === item.color && returned.size === item.size
    )
    setReturnForm({
      productCode: item.productCode,
      size: item.size,
      color: item.color,
      quantity: String(existing?.quantity || 0)
    })
  }

  const saveAdjustment = async () => {
    if (!selectedOrder) return
    if (selectedOrder.accountingStatus === 'unposted') return Taro.showToast({ title: '请先在接单页确认实配入账', icon: 'none' })
    if (returnQuantity > 0 && (!returnForm.productCode || !returnForm.color || !returnForm.size)) {
      Taro.showToast({ title: '请补全退货款号、颜色和尺码', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '正在同步', mask: true })
    try {
      if (isCloudReady()) {
        const confirmedReturns = selectedReturn?.status === 'confirmed'
          ? selectedReturn.items.map((item) => ({ productCode: item.productCode, color: item.color, size: item.size, quantity: item.quantity }))
          : []
        await adjustBill({
          orderId: selectedOrder.id,
          idempotencyKey: `bill-${selectedOrder.id}-${Date.now()}`,
          priceOverrides: selectedOrder.items.map((item) => ({ lineId: item.id, unitPriceCents: Math.round((prices[item.id] ?? item.unitPrice) * 100) })),
          returns: confirmedReturns,
          discountCents: Math.round(discountAmount * 100)
        })
        const refreshed = await bootstrapApp()
        if (refreshed) {
          setOrders(normaliseOrderItems(refreshed.orders))
          setBills(refreshed.bills)
        }
      } else {
        setOrders((current) => current.map((order) => order.id === selectedOrder.id
          ? { ...order, total: finalAmount, items: order.items.map((item) => ({ ...item, originalUnitPrice: item.originalUnitPrice || item.unitPrice, unitPrice: prices[item.id] ?? item.unitPrice })) }
          : order))
      }
      Taro.showToast({ title: '已保存并同步客户', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '账单同步失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  if (detail && selectedOrder && selectedCustomer) {
    return (
      <>
        <AppHeader title={`${selectedCustomer.name} · ${selectedOrder.date}账单`} back onBack={() => setDetail(false)} />
        <View className='page billing-detail'>
          <View className='card'>
            <View className='row between billing-detail__heading'><Text className='title'>订单商品</Text><Text className='mini'>单号 {selectedOrder.id}</Text></View>
            {selectedOrder.items.map((item) => {
              const currentPrice = prices[item.id] ?? item.unitPrice
              const oldPrice = item.originalUnitPrice || item.unitPrice
              return (
                <View className='billing-order-line' key={item.id}>
                  <View className='row between billing-line'>
                    <ProductImage className='billing-line__image' code={item.productCode} images={findProduct(productByCode, item.productCode)?.images} onClick={() => previewProductImages(findProduct(productByCode, item.productCode)?.images)} />
                    <View className='grow'><Text>{item.productCode} {item.color}</Text><Text className='sub'>{item.size}码 · {item.quantity}件</Text></View>
                    <View className='billing-line__pricing'>
                      <View className='billing-line__price-edit'>
                      {currentPrice !== oldPrice && <Text className='billing-line__old'>¥{oldPrice}</Text>}
                      <Text className='price'>¥{currentPrice}</Text>
                      <Text className='billing-line__step' onClick={() => stepPrice(item.id, -1)}>−</Text>
                      <Text className='billing-line__step' onClick={() => stepPrice(item.id, 1)}>＋</Text>
                      </View>
                      <Text className='billing-line__subtotal'>小计 ¥{(currentPrice * item.quantity).toFixed(2)}</Text>
                    </View>
                  </View>
                  <View className='divider' />
                </View>
              )
            })}
            <View className='billing-memory row between'><Text>客户价格记忆</Text><Text className='green'>✓ 保存后下次自动沿用</Text></View>
          </View>

          <View className='card'>
            <View className='row between'><View><Text className='title'>今日退货核对</Text><Text className='sub billing-return-tip'>照片预核对与实物确认分开；确认实收后才抵扣、回库</Text></View><Text className={`pill ${selectedReturn?.status === 'confirmed' ? 'green' : 'yellow'}`}>{selectedReturn?.status === 'confirmed' ? '已实收' : selectedReturn ? '待实物' : '无退货单'}</Text></View>
            {selectedReturn && <View className='billing-return-proof row between'><View><Text>退货照片 {selectedReturn.photos?.length || 0} 张</Text><Text className='sub'>{selectedReturn.status === 'awaiting_goods' ? '照片已通过，等待送回' : selectedReturn.status === 'inspection' ? '实物清点中' : selectedReturn.status === 'exception' ? `异常：${selectedReturn.exceptionReason || '待核对'}` : '档口已确认实收'}</Text></View><Button className='ghost-btn' onClick={() => selectedReturn.photos?.length ? Taro.previewImage({ urls: selectedReturn.photos }) : Taro.showToast({ title: '演示数据暂无照片', icon: 'none' })}>查看照片</Button></View>}
            <Text className='sub billing-return-tip'>按原订单准确规格清点，601 与 601-1、666 与薄666 不自动合并</Text>
            <View className='billing-return-options'>
              {selectedOrder.items.map((item) => {
                const active = item.productCode === returnForm.productCode && item.color === returnForm.color && item.size === returnForm.size
                return <Text key={item.id} className={`chip ${active ? 'active' : ''}`} onClick={() => chooseReturnLine(item)}>{item.productCode} · {item.color} · {item.size}码</Text>
              })}
            </View>
            <View className='billing-field'><Text>搜索/填写款号</Text><Input value={returnForm.productCode} onInput={(event) => setReturnForm((current) => ({ ...current, productCode: event.detail.value }))} placeholder='输入原订单款号' /></View>
            <View className='billing-grid'>
              <View><Text className='sub'>尺码</Text><Input value={returnForm.size} onInput={(event) => setReturnForm((current) => ({ ...current, size: event.detail.value }))} placeholder='如 L' /></View>
              <View><Text className='sub'>颜色</Text><Input value={returnForm.color} onInput={(event) => setReturnForm((current) => ({ ...current, color: event.detail.value }))} placeholder='如 米白' /></View>
              <View><Text className='sub'>数量</Text><Input type='number' value={returnForm.quantity} onInput={(event) => setReturnForm((current) => ({ ...current, quantity: event.detail.value }))} /></View>
            </View>
            <View className='row between billing-return'><Text>{selectedReturn?.status === 'confirmed' ? '已确认抵扣' : '实收确认后抵扣'} {returnQuantity} × ¥{returnPrice}</Text><Text>-¥{(selectedReturn?.status === 'confirmed' ? returnAmount : proposedReturnAmount).toFixed(2)}</Text></View>
            {selectedReturn && selectedReturn.status !== 'confirmed' && <Button className='primary-btn billing-confirm-return' onClick={confirmPhysicalReturn}>确认实收并计入库存</Button>}
            <View className='billing-field row between'><Text>优惠减免</Text><Input type='digit' value={discount} onInput={(event) => setDiscount(event.detail.value)} placeholder='0' /></View>
          </View>

          <View className='card billing-total'>
            <Text className='title billing-total__heading'>账款汇总</Text>
            <View className='row between'><Text>上期结欠</Text><Text>¥{(selectedBill?.openingBalance || 0).toFixed(2)}</Text></View>
            <View className='row between'><Text>今日实际出货</Text><Text>+¥{(selectedBill?.shipped ?? originalAmount).toFixed(2)}</Text></View>
            <View className='row between'><Text>调价差额</Text><Text>{adjustmentAmount >= 0 ? '-' : '+'}¥{Math.abs(adjustmentAmount).toFixed(2)}</Text></View>
            <View className='row between'><Text>已确认退货＋优惠</Text><Text>-¥{(returnAmount + discountAmount).toFixed(2)}</Text></View>
            <View className='row between'><Text>已确认收款</Text><Text>-¥{(selectedBill?.payments || 0).toFixed(2)}</Text></View>
            {!!selectedBill?.pendingPayments && <View className='row between'><Text>待确认转账</Text><Text className='sub'>¥{selectedBill.pendingPayments.toFixed(2)}（不抵账）</Text></View>}
            <View className='divider' />
            <View className='row between'><Text className='title'>本期结欠</Text><Text className='price billing-total__amount'>¥{finalAmount.toFixed(2)}</Text></View>
          </View>
          {selectedOrder.accountingStatus === 'unposted' && <Text className='sub'>该订单尚未实配入账，请先在接单页确认实配数量。</Text>}
          <Button disabled={selectedOrder.accountingStatus === 'unposted'} className='primary-btn' onClick={saveAdjustment}>保存并同步客户</Button>
        </View>
      </>
    )
  }

  return (
    <>
      <AppHeader title='账单' subtitle='示例档口' />
      <View className='page billing-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadBilling} />
        {!loading && !loadError && <>
        <View className='card billing-customer-admin' onClick={() => Taro.navigateTo({ url: '/pages/stall/customers/index' })}>
          <View><Text className='title'>客户管理</Text><Text className='sub'>审核新商家，查看客户资料、订单、退货与欠款</Text></View><Text className='title'>›</Text>
        </View>
        <View className='billing-stats'><View><Text className='title'>{customers.length}</Text><Text className='mini'>客户</Text></View><View><Text className='title'>¥{todayAmount.toFixed(2)}</Text><Text className='mini'>今日账款</Text></View><View><Text className='title'>¥{outstandingAmount.toFixed(2)}</Text><Text className='mini'>总欠款</Text></View></View>
        <Input className='billing-search' value={keyword} onInput={(event) => setKeyword(event.detail.value)} placeholder='搜索商家、联系人或手机号' />
        <View className='billing-filters'>{filters.map((item) => <Text key={item} className={`pill ${filter === item ? 'yellow' : ''}`} onClick={() => setFilter(item)}>{item}</Text>)}</View>
        <Text className='mini billing-result-count'>当前显示 {customerRows.length} 位客户</Text>

        {customerRows.map((row) => {
          const reportedOrders = filter.startsWith('今日') ? row.todayOrders : row.recentOrders
          const itemCount = reportedOrders.flatMap((order) => order.items).reduce((sum, item) => sum + item.quantity, 0)
          return (
            <View className='card billing-customer' key={row.customer.id} onClick={() => openDetail(row.customer, row.customerOrders)}>
              <View className='row between'><Text className='title'>{row.customer.name}</Text><Text className='price title'>¥{(row.todayBill?.payable || 0).toFixed(2)}</Text></View>
              <Text className='sub'>{reportedOrders.length ? `${reportedOrders.length}个每日批次 · ${itemCount}件 · 已报单` : '当前筛选周期未报单'}</Text>
              <View className='row between billing-customer__footer'><Text>总欠款 ¥{row.outstanding.toFixed(2)}</Text><Text>{row.customerOrders.length ? '查看详情 ›' : '暂无订单'}</Text></View>
            </View>
          )
        })}
        {!customerRows.length && <View className='card billing-empty'>此筛选条件下暂无客户</View>}
        </>}
      </View>
      <BottomNav role='stall' active='billing' />
    </>
  )
}
