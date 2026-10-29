import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import PageState from '@/components/PageState'
import { getAdminCustomerDetail, listAdminCustomers, requestErrorDetails, updateAdminCustomerStatus } from '@/services/cloud'
import type { AdminCustomerDetail, AdminCustomerSummary, MerchantStatus } from '@/types'
import './index.scss'

const filters: Array<{ label: string; value: 'all' | MerchantStatus }> = [
  { label: '待审核', value: 'pending' }, { label: '正常', value: 'active' },
  { label: '已暂停', value: 'paused' }, { label: '全部', value: 'all' }
]
const statusLabel: Record<string, string> = { profile_incomplete: '资料未完成', pending: '待审核', active: '正常', paused: '已暂停', disabled: '已停用' }

export default function StallCustomersPage() {
  const [items, setItems] = useState<AdminCustomerSummary[]>([])
  const initialStatus = Taro.getCurrentInstance().router?.params.status
  const [filter, setFilter] = useState<'all' | MerchantStatus>(['pending', 'active', 'paused', 'disabled'].includes(initialStatus || '') ? initialStatus as MerchantStatus : 'pending')
  const [keyword, setKeyword] = useState('')
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setItems((await listAdminCustomers()).items) }
    catch (reason) { setError(requestErrorDetails(reason, '客户资料加载失败')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => items.filter((item) => {
    if (filter !== 'all' && item.status !== filter) return false
    const text = `${item.name}${item.contactName || ''}${item.phone || ''}`.toLowerCase()
    return text.includes(keyword.trim().toLowerCase())
  }), [filter, items, keyword])

  const openDetail = async (merchantId: string) => {
    Taro.showLoading({ title: '加载客户', mask: true })
    try { setDetail(await getAdminCustomerDetail(merchantId)) }
    catch (reason) { Taro.showToast({ title: requestErrorDetails(reason).message, icon: 'none' }) }
    finally { Taro.hideLoading() }
  }

  const changeStatus = async (status: 'active' | 'paused' | 'disabled') => {
    if (!detail) return
    const action = status === 'active' ? '通过并启用' : status === 'paused' ? '暂停' : '停用'
    const confirm = await Taro.showModal({ title: `${action}商家`, content: `确认${action}“${detail.merchant.name}”吗？` })
    if (!confirm.confirm) return
    Taro.showLoading({ title: '正在保存', mask: true })
    try {
      await updateAdminCustomerStatus(detail.merchant.id, status)
      setDetail({ ...detail, merchant: { ...detail.merchant, status } })
      await load()
      Taro.showToast({ title: '已同步客户', icon: 'success' })
    } catch (reason) { Taro.showToast({ title: requestErrorDetails(reason).message, icon: 'none' }) }
    finally { Taro.hideLoading() }
  }

  if (detail) {
    const payable = detail.bills.filter((item) => item.status === 'open').reduce((sum, item) => sum + item.payable, 0)
    return <>
      <AppHeader title={detail.merchant.name} back onBack={() => setDetail(null)} />
      <View className='page customer-admin'>
        <View className='card customer-profile'>
          <View className='row between'><Text className='title'>商家资料</Text><Text className={`customer-status ${detail.merchant.status}`}>{statusLabel[detail.merchant.status || 'active']}</Text></View>
          <Text>联系人：{detail.merchant.contactName || '未填写'}</Text>
          <Text>手机号：{detail.merchant.phone || '未填写'}</Text>
          <Text>地址：{detail.merchant.address || '未填写'}</Text>
          <Text className='mini'>已绑定 {detail.memberCount} 个微信账户</Text>
        </View>
        <View className='customer-metrics'>
          <View><Text className='title'>{detail.orders.length}</Text><Text className='mini'>订单</Text></View>
          <View><Text className='title'>{detail.returns.length}</Text><Text className='mini'>退货</Text></View>
          <View><Text className='title'>{detail.canViewBills === false ? '未授权' : `¥${payable.toFixed(2)}`}</Text><Text className='mini'>未结账</Text></View>
        </View>
        <View className='card'><Text className='section-title'>客户款号映射</Text>
          {(detail.merchant.productAliases || []).map((alias) => <View className='row between customer-alias' key={alias.externalCode}><Text>{alias.externalCode}</Text><Text>→ 档口 {alias.productCode}</Text></View>)}
          {!detail.merchant.productAliases?.length && <Text className='sub'>暂无款号映射</Text>}
        </View>
        <View className='card'><Text className='section-title'>最近订单</Text>
          {detail.orders.slice(0, 5).map((order) => <View className='customer-record' key={order.id}><View className='row between'><Text>{order.date}</Text><Text>¥{order.total.toFixed(2)}</Text></View><Text className='mini'>{order.items.reduce((sum, item) => sum + item.quantity, 0)}件 · {order.status}</Text></View>)}
          {!detail.orders.length && <Text className='sub'>暂无订单</Text>}
        </View>
        <View className='card'><Text className='section-title'>最近退货与账单</Text>
          <Text className='sub'>退货 {detail.returns.length} 笔 · {detail.canViewBills === false ? '账单未授权' : `账单 ${detail.bills.length} 期`}</Text>
        </View>
        {detail.merchant.status !== 'active' && <Button className='primary-btn' onClick={() => changeStatus('active')}>通过审核并启用</Button>}
        {detail.merchant.status === 'active' && <Button className='ghost-btn' onClick={() => changeStatus('paused')}>暂停商家账号</Button>}
        {detail.merchant.status !== 'disabled' && <Button className='customer-disable' onClick={() => changeStatus('disabled')}>停用账号</Button>}
      </View>
    </>
  }

  return <>
    <AppHeader title='客户管理' back onBack={() => Taro.navigateBack()} />
    <View className='page customer-admin'>
      <PageState loading={loading} error={error?.message} requestId={error?.requestId} onRetry={load} />
      {!loading && !error && <>
        <View className='customer-summary'><View><Text className='title'>{items.length}</Text><Text className='mini'>全部客户</Text></View><View><Text className='title'>{items.filter((item) => item.status === 'pending').length}</Text><Text className='mini'>待审核</Text></View><View><Text className='title'>{items.filter((item) => item.status === 'active').length}</Text><Text className='mini'>正常使用</Text></View></View>
        <Input className='customer-search' value={keyword} onInput={(event) => setKeyword(event.detail.value)} placeholder='搜索商家、联系人或手机号' />
        <View className='customer-filters'>{filters.map((item) => <Text className={`pill ${filter === item.value ? 'yellow' : ''}`} key={item.value} onClick={() => setFilter(item.value)}>{item.label}</Text>)}</View>
        {visible.map((item) => <View className='card customer-item' key={item.id} onClick={() => openDetail(item.id)}>
          <View className='row between'><Text className='title'>{item.name}</Text><Text className={`customer-status ${item.status}`}>{statusLabel[item.status || 'active']}</Text></View>
          <Text className='sub'>{item.contactName || '未填写联系人'} · {item.phone || '未填写手机号'}</Text>
          <View className='row between customer-item__footer'><Text>{item.orderCount}单 · {item.returnCount}笔退货</Text><Text>{item.canViewBills === false ? '账单未授权' : `欠款 ¥${item.outstanding.toFixed(2)}`} ›</Text></View>
        </View>)}
        {!visible.length && <View className='card customer-empty'>当前条件下暂无客户</View>}
      </>}
    </View>
  </>
}
