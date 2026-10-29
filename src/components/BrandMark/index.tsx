import { Text, View } from '@tarojs/components'
import './index.scss'

interface Props { compact?: boolean; seal?: boolean }
export default function BrandMark({ compact = false, seal = false }: Props) {
  return <View className={`brand-mark ${compact ? 'brand-mark--compact' : ''} ${seal ? 'brand-mark--seal' : ''}`} aria-label='示例档口标志'><Text style={{ color: '#f3eee2', fontSize: '24px' }}>衣</Text></View>
}
