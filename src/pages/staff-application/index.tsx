import { useCallback, useState } from 'react'
import { View, Text, Button, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import PageState from '@/components/PageState'
import { applyForStaff, getStaffIdentity, requestErrorDetails } from '@/services/cloud'
import { enterRole } from '@/utils/navigation'
import type { StaffIdentity } from '@/types'
import './index.scss'

const statusText = { none: '申请加入示例档口档口', pending: '档口人员申请审核中', active: '档口权限已开通', rejected: '申请未通过', disabled: '档口权限已停用' }

export default function StaffApplicationPage() {
  const [data, setData] = useState<StaffIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const result = await getStaffIdentity()
      setData(result); setName((current) => current || result.application.name); setPhone((current) => current || result.application.phone)
    } catch (failure) { setError(requestErrorDetails(failure, '申请状态加载失败')) }
    finally { setLoading(false) }
  }, [])
  useDidShow(load)
  const status = data?.isStaff ? 'active' : data?.application.status || 'none'
  const submit = async () => {
    if (saving) return
    if (!name.trim() || !/^1\d{10}$/.test(phone)) return Taro.showToast({ title: '请填写姓名和正确手机号', icon: 'none' })
    if (!agreed) return Taro.showToast({ title: '请先阅读并同意协议', icon: 'none' })
    setSaving(true)
    try {
      await applyForStaff(name.trim(), phone, agreed)
      Taro.showToast({ title: '已提交主管理员审核', icon: 'none' })
      await load()
    } catch (failure) { Taro.showToast({ title: requestErrorDetails(failure, '提交失败').message, icon: 'none' }) }
    finally { setSaving(false) }
  }
  return <>
    <AppHeader title='加入档口' back />
    <View className='page staff-application'>
      <PageState loading={loading} error={error?.message} requestId={error?.requestId} onRetry={load} />
      {!loading && !error && data && <>
        <View className='card'>
          <Text className='title'>{statusText[status]}</Text>
          <Text className='sub staff-application__copy'>用于档口内部配货、商品与库存管理。提交申请不会自动获得权限，也不影响原有商家资料和订单。</Text>
          {data.application.reason && <Text className='staff-application__copy'>主管理员说明：{data.application.reason}</Text>}
          {status === 'pending' && <Text className='sub'>请等待主管理员在“我的 → 人员与权限”中审核。</Text>}
          {status === 'disabled' && <Text className='sub'>请联系主管理员恢复权限，当前不能进入档口工作台。</Text>}
        </View>
        {['none', 'rejected'].includes(status) && <>
          <View className='card'>
            <View className='staff-application__field'><Text>姓名</Text><Input value={name} maxlength={30} placeholder='填写真实姓名，方便核对' onInput={(event) => setName(event.detail.value)} /></View>
            <View className='staff-application__field'><Text>手机号</Text><Input value={phone} maxlength={11} type='number' placeholder='填写联系手机号' onInput={(event) => setPhone(event.detail.value)} /></View>
            <Text className='mini'>姓名、手机号和微信登录身份仅用于核实人员、审核权限及档口工作联系。</Text>
          </View>
          <View className='staff-application__agreement'>
            <Text onClick={() => setAgreed(!agreed)}>{agreed ? '☑' : '□'} 我已阅读并同意</Text>
            <Text onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=user' })}>《用户服务协议》</Text>
            <Text onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=privacy' })}>《隐私政策》</Text>
          </View>
          <Button className='primary-btn' loading={saving} disabled={saving} onClick={submit}>{status === 'rejected' ? '修改后重新申请' : '提交申请'}</Button>
        </>}
        {status === 'active' && <Button className='primary-btn' onClick={() => enterRole('stall')}>进入档口工作台</Button>}
        <Button className='ghost-btn' disabled={saving || loading} onClick={load}>刷新审核状态</Button>
      </>}
    </View>
  </>
}
