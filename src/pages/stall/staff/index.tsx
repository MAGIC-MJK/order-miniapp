import { useCallback, useRef, useState } from 'react'
import { View, Text, Button, Switch } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import PageState from '@/components/PageState'
import { getStaffIdentity, listStaff, reviewStaff, requestErrorDetails } from '@/services/cloud'
import type { StaffApplication } from '@/types'
import './index.scss'

const statuses = { pending: '待审核', active: '已开通', rejected: '未通过', disabled: '已停用', none: '未申请' }
const tabs = ['pending', 'active', 'disabled', 'rejected'] as const

export default function StaffManagementPage() {
  const [items, setItems] = useState<StaffApplication[]>([])
  const [tab, setTab] = useState<typeof tabs[number]>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null)
  const [billing, setBilling] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const identity = await getStaffIdentity()
      if (!identity.isOwner) throw new Error('仅主管理员可以管理档口人员')
      const result = await listStaff()
      setItems(result.items)
      setBilling(Object.fromEntries(result.items.map((item) => [item.id, item.canViewBills])))
    } catch (failure) { setError(requestErrorDetails(failure, '人员列表加载失败')) }
    finally { setLoading(false) }
  }, [])
  useDidShow(load)
  const review = async (item: StaffApplication, status: 'active' | 'rejected' | 'disabled') => {
    if (locked.current) return
    locked.current = true; setBusy(true)
    try {
      const label = status === 'active' ? item.status === 'active' ? '保存权限' : '开通档口权限' : status === 'rejected' ? '拒绝申请' : '停用档口权限'
      const confirmation = await Taro.showModal({ title: label, content: `${item.name} · ${item.phone}\n${status === 'active' ? `可管理配货、商品、库存和客户；账单权限${billing[item.id] ? '开启' : '关闭'}。` : status === 'disabled' ? '停用后不能继续进行档口操作，商家数据保留。' : '对方可以修改资料后重新申请。'}` })
      if (!confirmation.confirm) return
      await reviewStaff(item.id, status, billing[item.id] || false)
      Taro.showToast({ title: '已更新', icon: 'success' })
      await load()
    } catch (failure) { Taro.showToast({ title: requestErrorDetails(failure, '操作失败，请重试').message, icon: 'none' }) }
    finally { locked.current = false; setBusy(false) }
  }
  return <>
    <AppHeader title='人员与权限' subtitle='主管理员专属' back />
    <View className='page staff-management'>
      <PageState loading={loading} error={error?.message} requestId={error?.requestId} onRetry={load} />
      {!loading && !error && <>
        <View className='card'><Text className='sub'>请先通过姓名和手机号核实本人。员工可处理配货、商品、库存和客户业务；账单需单独授权。员工不能审核人员或变更主管理员。</Text></View>
        <View className='staff-management__tabs'>{tabs.map((status) => <View key={status} className={status === tab ? 'active' : ''} onClick={() => setTab(status)}>{statuses[status]} {items.filter((item) => item.status === status).length}</View>)}</View>
        {items.filter((item) => item.status === tab).length === 0 && <View className='card'><Text className='sub'>暂无{statuses[tab]}人员</Text></View>}
        {items.filter((item) => item.status === tab).map((item) => <View className='card' key={item.id}>
          <View className='row between'><Text className='section-title'>{item.name}</Text><Text className='sub'>{statuses[item.status]}</Text></View>
          <Text className='staff-management__phone'>{item.phone}</Text>
          {['pending', 'active', 'disabled'].includes(item.status) && <View className='row between staff-management__billing'><Text>查看、导出与调整账单</Text><Switch checked={billing[item.id] || false} disabled={busy} color='#164b3c' onChange={(event) => setBilling((current) => ({ ...current, [item.id]: event.detail.value }))} /></View>}
          <View className='staff-management__buttons'>
            {item.status !== 'rejected' && <Button className='primary-btn' disabled={busy} onClick={() => review(item, 'active')}>{item.status === 'pending' ? '通过并开通' : item.status === 'disabled' ? '恢复权限' : '保存权限'}</Button>}
            {item.status === 'pending' && <Button className='ghost-btn' disabled={busy} onClick={() => review(item, 'rejected')}>拒绝申请</Button>}
            {item.status === 'active' && <Button className='ghost-btn' disabled={busy} onClick={() => review(item, 'disabled')}>停用权限</Button>}
          </View>
        </View>)}
      </>}
    </View>
  </>
}
