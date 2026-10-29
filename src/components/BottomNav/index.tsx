import { View, Text } from '@tarojs/components'
import { relaunch } from '@/utils/navigation'
import type { UserRole } from '@/types'
import './index.scss'

interface NavItem {
  key: string
  label: string
  icon: string
  url: string
}

const customerNav: NavItem[] = [
  { key: 'order', label: '订货', icon: '衣', url: '/pages/customer/order/index' },
  { key: 'orders', label: '订单', icon: '单', url: '/pages/customer/orders/index' },
  { key: 'returns', label: '退货', icon: '退', url: '/pages/customer/returns/index' },
  { key: 'profile', label: '我的', icon: '我', url: '/pages/customer/profile/index' }
]

const stallNav: NavItem[] = [
  { key: 'listing', label: '上架', icon: '衣', url: '/pages/stall/listing/index' },
  { key: 'receiving', label: '接单', icon: '单', url: '/pages/stall/receiving/index' },
  { key: 'billing', label: '账单', icon: '账', url: '/pages/stall/billing/index' },
  { key: 'inventory', label: '库存', icon: '库', url: '/pages/stall/inventory/index' },
  { key: 'profile', label: '我的', icon: '我', url: '/pages/stall/profile/index' }
]

export default function BottomNav({ role, active }: { role: UserRole; active: string }) {
  const items = role === 'customer' ? customerNav : stallNav
  return (
    <View className='bottom-nav'>
      {items.map((item) => (
        <View key={item.key} className={`bottom-nav__item ${active === item.key ? 'active' : ''}`} onClick={() => relaunch(item.url)}>
          <Text className='bottom-nav__icon'>{item.icon}</Text>
          <Text>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}
