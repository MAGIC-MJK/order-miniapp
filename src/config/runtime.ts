export const runtimeConfig = {
  cloudEnvId: process.env.TARO_APP_CLOUD_ENV_ID || '',
  apiFunction: process.env.TARO_APP_API_FUNCTION || 'api',
  demoMode: !process.env.TARO_APP_CLOUD_ENV_ID
} as const

export function assertCloudConfigured() {
  if (!runtimeConfig.cloudEnvId) {
    throw new Error('尚未配置云开发环境，请先填写 TARO_APP_CLOUD_ENV_ID')
  }
}
