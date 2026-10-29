import Taro from '@tarojs/taro'
import type { Product, ProductImage } from '@/types'

const normaliseCode = (value: string) => value.trim().toUpperCase()

// 聚衣网旧图片地址目前返回 401，直接交给小程序渲染会产生网络错误。
export const isAvailableProductImage = (fileId: string) => !/^https:\/\/(?:img\d*\.)?k3cdn\.com\//i.test(fileId)

export function originalProductImageUrl(fileId: string) {
  // 聚衣网 CDN 的尺寸后缀是实际文件名的一部分，删除后会导致预览的第 2 张及后续图片无法打开。
  return fileId
}

export function productImageCandidates(fileId: string) {
  const original = originalProductImageUrl(fileId)
  return [...new Set([original, fileId].filter((url) => url && isAvailableProductImage(url)))]
}

export function productImageUrls(product?: Pick<Product, 'images'>) {
  return [...new Set((product?.images || []).map((image) => image.fileId).filter((url) => url && isAvailableProductImage(url)))]
}

export function productCover(product?: Pick<Product, 'images'>) {
  return product?.images?.find((image) => image.type === 'cover')?.fileId || product?.images?.[0]?.fileId || ''
}

export function productHighDefinitionCandidates(product?: Pick<Product, 'images'>) {
  const localCover = productCover(product)
  const remote = product?.images?.find((image) => /^https:\/\//.test(image.fileId) && image.type === 'display')?.fileId
    || product?.images?.find((image) => /^(https:\/\/|cloud:\/\/)/.test(image.fileId))?.fileId
  return [...new Set([...(remote ? productImageCandidates(remote) : []), localCover].filter((url) => url && isAvailableProductImage(url)))]
}

export function buildProductMap(products: Product[]) {
  return new Map(products.map((product) => [normaliseCode(product.code), product]))
}

export function findProduct(products: Map<string, Product>, code: string) {
  return products.get(normaliseCode(code))
}

export async function previewProductImages(images: ProductImage[] | undefined, current = 0) {
  const sources = (images || []).map((image) => image.fileId).filter((url) => url && isAvailableProductImage(url))
  const urls = [...new Set(sources)]
  if (!urls.length) return
  try {
    await Taro.previewImage({ current: urls[Math.min(current, urls.length - 1)], urls, showmenu: true })
  } catch {
    Taro.showToast({ title: '图片加载失败，请检查网络后重试', icon: 'none' })
  }
}

function isPermissionDenied(message: string) {
  return /auth deny|authorize:fail|permission|scope\.writePhotosAlbum/i.test(message)
}

export async function saveProductImage(fileId: string) {
  if (!fileId) {
    Taro.showToast({ title: '暂无可保存图片', icon: 'none' })
    return false
  }
  Taro.showLoading({ title: '正在保存', mask: true })
  try {
    let image: Taro.getImageInfo.SuccessCallbackResult | undefined
    let lastError: unknown
    for (const source of productImageCandidates(fileId)) {
      try {
        image = await Taro.getImageInfo({ src: source })
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!image) throw lastError || new Error('图片加载失败')
    await Taro.saveImageToPhotosAlbum({ filePath: image.path })
    Taro.showToast({ title: '已保存到系统相册', icon: 'success' })
    return true
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error)
    if (isPermissionDenied(message)) {
      const result = await Taro.showModal({ title: '需要相册权限', content: '请在设置中允许“保存到相册”，再重新点击保存。', confirmText: '去设置' })
      if (result.confirm) await Taro.openSetting()
    } else {
      Taro.showToast({ title: '图片保存失败，请长按图片保存', icon: 'none' })
    }
    return false
  } finally {
    Taro.hideLoading()
  }
}
