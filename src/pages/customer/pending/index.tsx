import { useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BrandMark from '@/components/BrandMark'
import { loginWithWechat } from '@/services/cloud'
import { enterRole, relaunch, saveRole } from '@/utils/navigation'
import './index.scss'

const statusCopy = {
  pending: ['资料审核中', '示例档口确认商家身份后，即可开始订货并查看专属账单。'],
  paused: ['账号已暂停', '账号暂时不能订货，请联系示例档口核对。'],
  disabled: ['账号已停用', '如需恢复，请联系示例档口。'],
  profile_incomplete: ['资料尚未完成', '请先完善商家名称、联系人和手机号。']
} as const

export default function CustomerPendingPage() {
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<keyof typeof statusCopy>('pending')
  const refresh = async () => {
    if (checking) return
    setChecking(true)
    try {
      saveRole('customer')
      const result = await loginWithWechat('customer')
      if (!result.profileComplete) return relaunch('/pages/customer/register/index')
      if (result.merchantStatus === 'active') {
        Taro.showToast({ title: '审核已通过', icon: 'success' })
        return enterRole('customer')
      }
      setStatus((result.merchantStatus as keyof typeof statusCopy) || 'pending')
      Taro.showToast({ title: '状态已更新', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '状态查询失败', icon: 'none' })
    } finally { setChecking(false) }
  }

  return <>
    <AppHeader title='商家认证' />
    <View className='page pending-page'>
      <View className='pending-mark'><BrandMark seal /></View>
      <View className='card pending-card'>
        <Text className='pending-icon'>{status === 'pending' ? '⌛' : '!'}</Text>
        <Text className='title pending-title'>{statusCopy[status][0]}</Text>
        <Text className='sub'>{statusCopy[status][1]}</Text>
        <View className='divider' />
        <Text className='mini'>审核通过后，订单、退货、账单都会绑定到当前微信商家账户。</Text>
      </View>
      <Button loading={checking} className='primary-btn' onClick={refresh}>刷新审核状态</Button>
      <Button className='ghost-btn' onClick={() => Taro.navigateTo({ url: '/pages/staff-application/index' })}>我是档口人员 · 申请加入</Button>
      <Button className='ghost-btn' onClick={() => relaunch('/pages/auth/index')}>返回登录页</Button>
    </View>
  </>
}
