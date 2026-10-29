import { useEffect, useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import PageState from '@/components/PageState'
import { bootstrapApp, getWechatPhoneNumber, isCloudReady, requestErrorDetails, updateMerchantProfile } from '@/services/cloud'
import { relaunch } from '@/utils/navigation'
import './index.scss'

export default function CustomerRegisterPage() {
  const isEdit = Taro.getCurrentInstance().router?.params.mode === 'edit'
  const isTest = Taro.getCurrentInstance().router?.params.mode === 'test'
  const [form, setForm] = useState({ shopName: '', contactName: '', phone: '', address: '' })
  const [agreed, setAgreed] = useState(isEdit)
  const [loading, setLoading] = useState(isEdit && isCloudReady())
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!isEdit || !isCloudReady()) return
    setLoading(true); setLoadError(null)
    bootstrapApp().then((result) => {
      if (!result?.merchant) return
      setForm({
        shopName: result.merchant.name || '',
        contactName: result.merchant.contactName || '',
        phone: result.merchant.phone || '',
        address: result.merchant.address || ''
      })
    }).catch((error) => setLoadError(requestErrorDetails(error, '商家资料加载失败')))
      .finally(() => setLoading(false))
  }, [isEdit])

  const openAgreement = async (type: 'user' | 'privacy') => {
    await Taro.navigateTo({ url: `/pages/legal/index?type=${type === 'privacy' ? 'privacy' : 'user'}` })
  }

  const submit = async () => {
    if (!form.shopName.trim() || !form.contactName.trim() || !/^1\d{10}$/.test(form.phone)) {
      Taro.showToast({ title: '请填写商家名称、联系人和正确手机号', icon: 'none' })
      return
    }
    if (!agreed) {
      Taro.showToast({ title: '请先阅读并同意协议与隐私指引', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '正在保存', mask: true })
    try {
      const result = isCloudReady() && !isTest ? await updateMerchantProfile({ ...form, shopName: form.shopName.trim(), contactName: form.contactName.trim() }) : null
      Taro.showToast({ title: isTest ? '测试完成，未写入数据' : result?.status === 'active' ? '商家资料已保存' : '资料已提交审核', icon: 'none' })
      setTimeout(() => relaunch(isTest ? '/pages/auth/index' : result?.status === 'active' ? '/pages/customer/order/index' : '/pages/customer/pending/index'), 500)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '资料保存失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const fillWechatPhone = async (event: { detail: { code?: string; errMsg?: string } }) => {
    if (!agreed) return Taro.showToast({ title: '请先阅读并同意隐私政策', icon: 'none' })
    if (!event.detail.code) {
      if (!String(event.detail.errMsg || '').includes('deny')) Taro.showToast({ title: '未能获取微信手机号，可手动填写', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '正在获取', mask: true })
    try {
      const result = await getWechatPhoneNumber(event.detail.code)
      update('phone', result.phone)
      Taro.showToast({ title: '手机号已填写', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '获取失败，请手动填写', icon: 'none' })
    } finally { Taro.hideLoading() }
  }

  return (
    <>
      <AppHeader title={isTest ? '测试商家注册' : '完善商家资料'} back onBack={() => isEdit ? Taro.navigateBack() : relaunch('/pages/auth/index')} />
      <View className='page register-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={() => relaunch('/pages/customer/register/index?mode=edit')} />
        {!loading && !loadError && <>
        <View className='card register-intro'>
          {isTest && <Text className='pill yellow'>开发测试 · 不写入云端</Text>}
          <Text className='title'>欢迎使用档口订货</Text>
          <Text className='sub'>首次登录请填写真实商家资料，用于订单归属、对账和收货联系。</Text>
        </View>
        <View className='card register-form'>
          <View className='register-field'><Text>商家名称 *</Text><Input value={form.shopName} onInput={(event) => update('shopName', event.detail.value)} placeholder='如 示例客户甲' maxlength={40} /></View>
          <View className='register-field'><Text>联系人 *</Text><Input value={form.contactName} onInput={(event) => update('contactName', event.detail.value)} placeholder='请输入联系人姓名' maxlength={20} /></View>
          <View className='register-field'><View className='row between'><Text>手机号 *</Text><Button className='register-phone-button' disabled={!agreed} openType={agreed ? 'getPhoneNumber' : undefined} onGetPhoneNumber={fillWechatPhone}>微信手机号快捷填写</Button></View><Input type='number' value={form.phone} onInput={(event) => update('phone', event.detail.value)} placeholder='也可以手动填写' maxlength={11} /></View>
          <View className='register-field'><Text>收货地址</Text><Input value={form.address} onInput={(event) => update('address', event.detail.value)} placeholder='可稍后补充' maxlength={120} /></View>
        </View>
        <View className='register-agreement' onClick={() => setAgreed(!agreed)}>
          <Text className={agreed ? 'green' : ''}>{agreed ? '☑' : '□'}</Text>
          <Text className='sub'>我已阅读并同意</Text>
          <Text className='register-agreement__link' onClick={(event) => { event.stopPropagation(); openAgreement('user') }}>《用户服务协议》</Text>
          <Text className='sub'>和</Text>
          <Text className='register-agreement__link' onClick={(event) => { event.stopPropagation(); openAgreement('privacy') }}>《隐私政策》</Text>
        </View>
        <Button className='primary-btn' onClick={submit}>{isEdit ? '保存商家资料' : '提交商家认证'}</Button>
        <Text className='mini register-tip'>手机号不会展示给其他客户，仅用于示例档口与本商家订单联系。</Text>
        </>}
      </View>
    </>
  )
}
