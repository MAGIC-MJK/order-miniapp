import { Button, Text, View } from '@tarojs/components'
import './index.scss'

type Props = {
  loading?: boolean
  error?: string
  requestId?: string
  empty?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onRetry?: () => void
}

export default function PageState({ loading, error, requestId, empty, emptyTitle = '暂无内容', emptyDescription, onRetry }: Props) {
  if (!loading && !error && !empty) return null
  return (
    <View className='page-state' role={error ? 'alert' : undefined}>
      {loading && <View className='page-state__spinner' />}
      <Text className='page-state__title'>{loading ? '正在加载' : error ? '暂时无法加载' : emptyTitle}</Text>
      <Text className='page-state__description'>{loading ? '正在同步示例档口最新数据' : error || emptyDescription || '暂时没有需要处理的内容'}</Text>
      {requestId && <Text className='page-state__request'>请求编号：{requestId}</Text>}
      {error && onRetry && <Button className='ghost-btn page-state__retry' onClick={onRetry}>重新加载</Button>}
    </View>
  )
}
