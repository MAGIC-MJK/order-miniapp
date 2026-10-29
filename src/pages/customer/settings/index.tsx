import { useCallback, useEffect, useState } from 'react'
import { Button, Switch, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import PageState from '@/components/PageState'
import { listImportTasks, requestErrorDetails } from '@/services/cloud'
import type { ImportTask } from '@/types'
import './index.scss'

const NOTIFICATION_KEY = 'yg-notification-settings'
const labels = { account: '账号与档口', imports: '导单记录', notifications: '消息通知', security: '账号与安全', privacy: '客服与隐私' } as const
type Section = keyof typeof labels

export default function CustomerSettingsPage() {
  const rawSection = Taro.getCurrentInstance().router?.params.section
  const section: Section = rawSection && rawSection in labels ? rawSection as Section : 'account'
  const [tasks, setTasks] = useState<ImportTask[]>([])
  const [loading, setLoading] = useState(section === 'imports')
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null)
  const [notifications, setNotifications] = useState(() => ({ order: true, return: true, bill: true, ...Taro.getStorageSync(NOTIFICATION_KEY) }))
  const loadTasks = useCallback(async () => {
    if (section !== 'imports') return
    setLoading(true); setError(null)
    try { setTasks((await listImportTasks()).items) }
    catch (reason) { setTasks([]); setError(requestErrorDetails(reason, '导单记录加载失败')) }
    finally { setLoading(false) }
  }, [section])
  useEffect(() => { loadTasks() }, [loadTasks])

  const updateNotification = (key: keyof typeof notifications, value: boolean) => {
    const next = { ...notifications, [key]: value }
    setNotifications(next); Taro.setStorageSync(NOTIFICATION_KEY, next)
    Taro.showToast({ title: '已保存', icon: 'success' })
  }

  return <>
    <AppHeader title={labels[section]} back />
    <View className='page settings-page'>
      {section === 'imports' && <>
        <PageState loading={loading} error={error?.message} requestId={error?.requestId} onRetry={loadTasks} empty={!loading && !error && !tasks.length} emptyTitle='暂无导单记录' emptyDescription='上传截图或提交链接后，任务会显示在这里' />
        {!loading && !error && tasks.map((task) => <View className='card settings-task' key={task.id}>
          <View className='row between'><Text className='title'>{task.source === 'screenshot' ? '截图导单' : '链接导单'}</Text><Text className={`pill ${task.status === 'failed' ? 'red' : task.status === 'completed' || task.status === 'review' ? 'green' : 'yellow'}`}>{task.status === 'queued' ? '等待识别' : task.status === 'processing' ? '识别中' : task.status === 'failed' ? '失败' : '已完成'}</Text></View>
          <Text className='sub'>{task.message || '任务已提交'}</Text><Text className='mini'>{task.id}</Text>
        </View>)}
      </>}
      {section === 'notifications' && <View className='card settings-list'>{([['order', '订单状态'], ['return', '退货核对'], ['bill', '账单同步']] as const).map(([key, label]) => <View className='row between settings-row' key={key}><View><Text>{label}</Text><Text className='sub'>接收对应业务变化提醒</Text></View><Switch color='#174c3c' checked={notifications[key]} onChange={(event) => updateNotification(key, event.detail.value)} /></View>)}</View>}
      {section === 'account' && <View className='card settings-list'><View className='row between settings-row'><Text>关联档口</Text><Text>示例档口</Text></View><View className='row between settings-row'><Text>账号状态</Text><Text className='green'>正常</Text></View><Text className='sub settings-copy'>订单、退货和账单将同步到该档口。</Text></View>}
      {section === 'security' && <View className='card settings-list'><View className='row between settings-row'><Text>登录方式</Text><Text>微信身份</Text></View><View className='row between settings-row'><Text>密码</Text><Text className='sub'>无需密码</Text></View><Button className='ghost-btn' onClick={() => { Taro.clearStorageSync(); Taro.reLaunch({ url: '/pages/auth/index' }) }}>清除本机缓存并退出</Button></View>}
      {section === 'privacy' && <View className='card settings-list'><Text className='title'>协议与隐私</Text><Text className='sub settings-copy'>查看我们收集和使用商家资料、订单及退货照片的具体说明。</Text><Button className='ghost-btn' onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=privacy' })}>查看隐私政策</Button><Button className='ghost-btn' onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=user' })}>查看用户服务协议</Button></View>}
    </View>
  </>
}
