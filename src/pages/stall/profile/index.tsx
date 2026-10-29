import { useCallback, useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import BrandMark from '@/components/BrandMark'
import PageState from '@/components/PageState'
import { getStaffIdentity, listStaff, listAdminCustomers, requestErrorDetails } from '@/services/cloud'
import { enterRole, relaunch } from '@/utils/navigation'
import type { AdminCustomerSummary, StaffIdentity } from '@/types'
import './index.scss'

export default function StallProfilePage() {
  const [customers, setCustomers] = useState<AdminCustomerSummary[]>([])
  const [identity, setIdentity] = useState<StaffIdentity | null>(null)
  const [pendingStaff, setPendingStaff] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const current = await getStaffIdentity()
      setIdentity(current)
      setCustomers((await listAdminCustomers()).items)
      if (current.isOwner) setPendingStaff((await listStaff()).items.filter((item) => item.status === 'pending').length)
    }
    catch (error) { setLoadError(requestErrorDetails(error, '档口资料加载失败')) }
    finally { setLoading(false) }
  }, [])
  useDidShow(load)

  const pending = useMemo(() => customers.filter((item) => item.status === 'pending'), [customers])
  const active = useMemo(() => customers.filter((item) => !item.status || item.status === 'active'), [customers])
  const outstanding = useMemo(() => customers.reduce((sum, item) => sum + item.outstanding, 0), [customers])
  const openCustomers = (pendingOnly = false) => Taro.navigateTo({ url: `/pages/stall/customers/index${pendingOnly ? '?status=pending' : ''}` })

  return <>
    <AppHeader title='我的' subtitle='示例档口' />
    <View className='page stall-profile'>
      <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={load} />
      {!loading && !loadError && <>
        <View className='stall-profile__hero'>
          <View className='stall-profile__avatar'><BrandMark /></View>
          <View><Text className='stall-profile__name'>{identity?.isOwner ? '示例档口' : identity?.application.name || '档口员工'}</Text><Text className='sub'>{identity?.isOwner ? '主管理员' : '档口员工'} · 微信身份已验证</Text></View>
        </View>

        <View className='stall-profile__stats'>
          <View><Text className='title'>{active.length}</Text><Text className='mini'>正常客户</Text></View>
          <View><Text className={`title ${pending.length ? 'red' : ''}`}>{pending.length}</Text><Text className='mini'>待审核</Text></View>
          <View><Text className='title'>{identity?.canViewBills ? `¥${outstanding.toFixed(2)}` : '未授权'}</Text><Text className='mini'>客户欠款</Text></View>
        </View>

        <View className={`card stall-profile__review ${pending.length ? 'has-pending' : ''}`} onClick={() => openCustomers(true)}>
          <View className='row between'>
            <View><Text className='section-title'>商家认证审核</Text><Text className='sub'>{pending.length ? `有 ${pending.length} 位新商家等待确认` : '当前没有待审核商家'}</Text></View>
            <Text className={`stall-profile__badge ${pending.length ? '' : 'empty'}`}>{pending.length}</Text>
          </View>
          {pending.slice(0, 3).map((item) => <View className='row between stall-profile__pending' key={item.id}><Text>{item.name}</Text><Text className='sub'>{item.contactName || '未填写联系人'}　›</Text></View>)}
        </View>

        <View className='card stall-profile__menu'>
          {identity?.isOwner && <View className='row between stall-profile__menu-item' onClick={() => Taro.navigateTo({ url: '/pages/stall/staff/index' })}><View><Text>人员与权限</Text><Text className='mini'>审核档口申请、账单授权、停用与恢复</Text></View><Text className={pendingStaff ? 'red' : 'sub'}>{pendingStaff ? `${pendingStaff} 人待审核` : '管理 ›'}</Text></View>}
          <View className='row between stall-profile__menu-item' onClick={() => openCustomers()}><View><Text>全部客户</Text><Text className='mini'>资料、订单、退货、账单与款号映射</Text></View><Text className='sub'>{customers.length}位 ›</Text></View>
          <View className='row between stall-profile__menu-item' onClick={() => Taro.navigateTo({ url: '/pages/stall/customers/index?status=paused' })}><Text>暂停或停用账号</Text><Text className='sub'>查看 ›</Text></View>
          <View className='row between stall-profile__menu-item'><Text>云端数据状态</Text><Text className='green'>已连接</Text></View>
        </View>

        <View className='card stall-profile__menu'>
          <View className='row between stall-profile__menu-item' onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=privacy' })}><Text>隐私政策</Text><Text className='sub'>查看 ›</Text></View>
          <View className='row between stall-profile__menu-item' onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=user' })}><Text>用户服务协议</Text><Text className='sub'>查看 ›</Text></View>
          <View className='row between stall-profile__menu-item' onClick={() => enterRole('customer')}><Text>切换到客户商家端</Text><Text className='sub'>预览 ›</Text></View>
          <View className='row between stall-profile__menu-item' onClick={() => relaunch('/pages/auth/index')}><Text>退出当前工作台</Text><Text className='sub'>›</Text></View>
        </View>
      </>}
    </View>
    <BottomNav role='stall' active='profile' />
  </>
}
