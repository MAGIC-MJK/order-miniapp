import Taro from '@tarojs/taro'

export type DevScenario = 'normal' | 'empty' | 'error' | 'slow'
const DEV_SCENARIO_KEY = 'yg-dev-scenario'

export function readDevScenario(): DevScenario {
  if (process.env.NODE_ENV === 'production') return 'normal'
  return Taro.getStorageSync<DevScenario>(DEV_SCENARIO_KEY) || 'normal'
}

export function saveDevScenario(value: DevScenario) {
  if (process.env.NODE_ENV !== 'production') Taro.setStorageSync(DEV_SCENARIO_KEY, value)
}
