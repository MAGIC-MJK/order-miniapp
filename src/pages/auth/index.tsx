import { useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BrandMark from '@/components/BrandMark'
import { enterRole, relaunch, saveRole } from '@/utils/navigation'
import { isCloudReady, loginWithWechat } from '@/services/cloud'
import { saveDevScenario } from '@/utils/devScenario'
import './index.scss'

export default function AuthPage() {
  const [loggingIn, setLoggingIn] = useState(false)
  const [agreed, setAgreed] = useState(false)

  const openAgreement = async (type: 'user' | 'privacy') => {
    await Taro.navigateTo({ url: `/pages/legal/index?type=${type === 'privacy' ? 'privacy' : 'user'}` })
  }

  const wechatLogin = async (requestedRole: 'customer' | 'stall') => {
    if (loggingIn) return
    if (!agreed) {
      Taro.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }
    setLoggingIn(true)
    Taro.showLoading({ title: '登录中', mask: true })
    try {
      saveRole(requestedRole)
      const result = await loginWithWechat(requestedRole)
      if (requestedRole === 'stall' && result.role !== 'stall') {
        saveRole('customer')
        await Taro.navigateTo({ url: '/pages/staff-application/index' })
        return
      }
      if (result.role === 'customer' && !result.profileComplete) {
        saveRole('customer')
        await relaunch('/pages/customer/register/index')
        return
      }
      if (result.role === 'customer' && result.merchantStatus !== 'active') {
        saveRole('customer')
        await relaunch('/pages/customer/pending/index')
        return
      }
      await enterRole(result.role)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '登录失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
      setLoggingIn(false)
    }
  }

  const testRegistration = async () => {
    if (!agreed) return Taro.showToast({ title: '请先阅读并同意协议', icon: 'none' })
    setLoggingIn(true)
    try {
      saveRole('stall')
      const result = await loginWithWechat('stall')
      if (result.role !== 'stall') return Taro.showToast({ title: '仅档口管理员可以测试注册流程', icon: 'none' })
      saveRole('customer')
      await Taro.navigateTo({ url: '/pages/customer/register/index?mode=test' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '身份验证失败', icon: 'none' })
    } finally { setLoggingIn(false) }
  }

  const testPageState = async () => {
    if (!agreed) return Taro.showToast({ title: '请先阅读并同意协议', icon: 'none' })
    setLoggingIn(true)
    try {
      saveRole('stall')
      const result = await loginWithWechat('stall')
      if (result.role !== 'stall') return Taro.showToast({ title: '仅档口管理员可以使用测试场景', icon: 'none' })
      const selection = await Taro.showActionSheet({ itemList: ['商家端空数据', '模拟断网', '模拟弱网 3 秒', '恢复正常数据'] })
      saveDevScenario((['empty', 'error', 'slow', 'normal'] as const)[selection.tapIndex])
      saveRole('customer')
      await relaunch('/pages/customer/order/index')
    } catch (error) {
      if (!String(error).includes('cancel')) Taro.showToast({ title: error instanceof Error ? error.message : '测试场景打开失败', icon: 'none' })
    } finally { setLoggingIn(false) }
  }

  return (
    <>
      <AppHeader title='登录档口订货' />
      <View className='auth page'>
        <View className='auth__logo'><BrandMark seal /></View>
        <Text className='auth__headline'>档口订货</Text>
        <Text className='auth__intro'>客户订货、档口配货、账单和库存同步管理</Text>

        <View className='card'>
          <Text className='section-title auth__section'>选择工作台</Text>
          {isCloudReady() ? (
            <>
              <Text className='sub'>请选择本次进入的工作台。商家入口用于订货；档口入口仅限已绑定的管理员。</Text>
              <Button loading={loggingIn} className='primary-btn auth__button' onClick={() => wechatLogin('customer')}>我是商家 · 进入订货端</Button>
              <Button disabled={loggingIn} className='ghost-btn auth__button auth__button--secondary' onClick={() => wechatLogin('stall')}>我是档口 · 进入管理端</Button>
              <Text className='sub'>档口人员首次进入，可提交申请，由主管理员审核开通。</Text>
              {process.env.NODE_ENV !== 'production' && <Button disabled={loggingIn} className='ghost-btn auth__button auth__button--secondary' onClick={testRegistration}>开发版 · 测试新商家注册</Button>}
              {process.env.NODE_ENV !== 'production' && <Button disabled={loggingIn} className='ghost-btn auth__button auth__button--secondary' onClick={testPageState}>开发版 · 测试空态与网络错误</Button>}
            </>
          ) : (
            <>
              <Text className='sub'>当前未配置云开发，保留双身份入口用于本机检查页面。</Text>
              <Button className='primary-btn auth__button' onClick={() => enterRole('customer')}>以客户商家身份进入</Button>
              <Button className='ghost-btn auth__button' onClick={() => enterRole('stall')}>以示例档口身份进入</Button>
            </>
          )}
        </View>

        <View className='auth__privacy' onClick={() => setAgreed((value) => !value)}>
          <Text className={agreed ? 'green' : ''}>{agreed ? '☑' : '□'}</Text>
          <Text>我已阅读并同意</Text>
          <Text className='auth__privacy-link' onClick={(event) => { event.stopPropagation(); openAgreement('user') }}>《用户服务协议》</Text>
          <Text>和</Text>
          <Text className='auth__privacy-link' onClick={(event) => { event.stopPropagation(); openAgreement('privacy') }}>《隐私政策》</Text>
        </View>
      </View>
    </>
  )
}
