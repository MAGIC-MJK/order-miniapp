import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import BrandMark from '@/components/BrandMark'
import './index.scss'

interface Props {
  title: string
  back?: boolean
  subtitle?: string
  onBack?: () => void
}

export default function AppHeader({ title, back, subtitle, onBack }: Props) {
  const statusBarHeight = Taro.getWindowInfo?.().statusBarHeight || 20
  return (
    <View className='app-header' style={{ paddingTop: `${statusBarHeight}px` }}>
      <View className='app-header__bar'>
        {back ? <Text className='app-header__back' onClick={() => onBack ? onBack() : Taro.navigateBack()}>‹</Text> : <View className='app-header__brand'><BrandMark compact /></View>}
        <View className='app-header__center'>
          <Text className='app-header__title'>{title}</Text>
          {subtitle && <Text className='app-header__subtitle'>{subtitle}</Text>}
        </View>
        <View className='app-header__spacer' />
      </View>
    </View>
  )
}
