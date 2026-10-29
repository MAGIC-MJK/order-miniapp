import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import BrandMark from '@/components/BrandMark'
import PageState from '@/components/PageState'
import { enterRole, relaunch } from '@/utils/navigation'
import Taro from '@tarojs/taro'
import { bootstrapApp, isCloudReady, requestErrorDetails } from '@/services/cloud'
import type { BootstrapResult } from '@/types'
import './index.scss'

const menus = [
  ['商家资料', '/pages/customer/register/index?mode=edit'],
  ['收货地址', '/pages/customer/register/index?mode=edit'],
  ['关联档口　示例档口', '/pages/customer/settings/index?section=account'],
  ['导单记录', '/pages/customer/settings/index?section=imports'],
  ['消息通知', '/pages/customer/settings/index?section=notifications'],
  ['账号与安全', '/pages/customer/settings/index?section=security'],
  ['客服与隐私', '/pages/customer/settings/index?section=privacy']
] as const

export default function CustomerProfilePage() {
  const [data, setData] = useState<BootstrapResult | null>(null)
  const [loading, setLoading] = useState(isCloudReady())
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const loadProfile = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try { setData(await bootstrapApp()) }
    catch (error) { setData(null); setLoadError(requestErrorDetails(error, '商家资料加载失败')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { loadProfile() }, [loadProfile])
  const month = useMemo(() => {
    const now = new Date()
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 7)
  }, [])
  const name = data?.merchant?.name || '未完善商家资料'
  const phone = data?.merchant?.phone || ''
  const maskedPhone = phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone
  const monthOrders = data?.orders.filter((order) => order.date.startsWith(month)) || []
  const monthPayable = data?.bills.filter((bill) => bill.date.startsWith(month)).reduce((sum, bill) => sum + bill.payable, 0) ?? 0

  return (
    <>
      <AppHeader title='我的' />
      <View className='page profile-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadProfile} />
        {!loading && !loadError && <>
        <View className='profile-hero'>
          <View className='profile-hero__avatar'><BrandMark /></View>
          <View><Text className='profile-hero__name'>{name}</Text><Text className='profile-hero__phone'>{maskedPhone || '未填写手机号'} · 微信身份已验证</Text></View>
        </View>

        <View className='profile-stats'>
          <View><Text className='profile-stats__value'>¥{monthPayable.toFixed(2)}</Text><Text className='sub'>本月应付</Text></View>
          <View><Text className='profile-stats__value'>{monthOrders.length}</Text><Text className='sub'>本月订单</Text></View>
          <View><Text className='profile-stats__value'>—</Text><Text className='sub'>导单记录</Text></View>
        </View>

        <View className='card profile-menu'>
          {menus.map(([menu, url]) => <View key={menu} className='row between profile-menu__item' onClick={() => Taro.navigateTo({ url })}><Text>{menu}</Text><Text className='sub'>›</Text></View>)}
        </View>
        <View className='card profile-menu'>
          <View className='row between profile-menu__item'><Text>账号状态</Text><Text className='green'>正常</Text></View>
          {data?.user.authorizedRole !== 'stall' && <View className='row between profile-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/staff-application/index' })}><Text>申请加入档口</Text><Text className='sub'>申请与审核状态 ›</Text></View>}
          {data?.user.authorizedRole === 'stall' && <View className='row between profile-menu__item' onClick={() => enterRole('stall')}><Text>切换到档口工作台</Text><Text className='sub'>管理员工作台 ›</Text></View>}
        </View>
        <View className='ghost-btn' onClick={() => relaunch('/pages/auth/index')}>退出当前工作台</View>
        </>}
      </View>
      <BottomNav role='customer' active='profile' />
    </>
  )
}
