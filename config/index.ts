import { defineConfig } from '@tarojs/cli'
import path from 'node:path'

const cloudEnvId = process.env.TARO_APP_CLOUD_ENV_ID || ''
const apiFunction = process.env.TARO_APP_API_FUNCTION || 'api'

export default defineConfig({
  projectName: 'order-miniapp',
  date: '2026-08-08',
  designWidth: 375,
  deviceRatio: {
    375: 2,
    640: 1.17,
    750: 1
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  env: {
    TARO_APP_CLOUD_ENV_ID: JSON.stringify(cloudEnvId),
    TARO_APP_API_FUNCTION: JSON.stringify(apiFunction)
  },
  alias: {
    '@': path.resolve(__dirname, '..', 'src')
  },
  cache: { enable: true },
  plugins: ['@tarojs/plugin-platform-weapp'],
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  }
})
