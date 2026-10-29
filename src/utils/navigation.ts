import Taro from '@tarojs/taro'
import type { UserRole } from '@/types'

const ROLE_KEY = 'yg-user-role'

export const roleHome: Record<UserRole, string> = {
  customer: '/pages/customer/order/index',
  stall: '/pages/stall/receiving/index'
}

export function saveRole(role: UserRole) {
  Taro.setStorageSync(ROLE_KEY, role)
}

export function readRole(): UserRole | undefined {
  return Taro.getStorageSync(ROLE_KEY) || undefined
}

export function relaunch(url: string) {
  return Taro.reLaunch({ url })
}

export function enterRole(role: UserRole) {
  saveRole(role)
  return relaunch(roleHome[role])
}

