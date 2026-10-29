import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Button, Image, Swiper, SwiperItem } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductCard from '@/components/ProductCard'
import PatternStory from '@/components/PatternStory'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products, withLocalProductCovers } from '@/data/mock'
import {
  productCategories,
  productMatchesCategory,
  type ProductCategoryId
} from '@/data/productCategories'
import { getPatternStory } from '@/data/patternStories'
import { useCart } from '@/store/cart'
import {
  applyImportTask,
  bootstrapApp,
  createImportTask,
  isCloudReady,
  syncCart,
  uploadImportImages,
  waitForImport
} from '@/services/cloud'
import { requestErrorDetails } from '@/services/cloud'
import type { ImportTask, Product } from '@/types'
import { isAvailableProductImage, previewProductImages, productImageCandidates, saveProductImage } from '@/utils/productImages'
import { readDevScenario } from '@/utils/devScenario'
import './index.scss'

type ProductViewMode = 'list' | 'grid'
const PRODUCT_VIEW_MODE_KEY = 'yg-product-view-mode'

function GalleryImage({ fileId, onClick }: { fileId: string; onClick: () => void }) {
  const candidates = useMemo(() => productImageCandidates(fileId), [fileId])
  const [index, setIndex] = useState(0)
  const source = candidates[index]

  useEffect(() => setIndex(0), [fileId])

  return <Image src={source} mode='aspectFit' lazyLoad showMenuByLongpress webp onClick={onClick} onError={() => setIndex((current) => Math.min(current + 1, candidates.length - 1))} />
}

export default function CustomerOrderPage() {
  const [keyword, setKeyword] = useState('')
  const [activeCategory, setActiveCategory] = useState<ProductCategoryId>('all')
  const [viewMode, setViewMode] = useState<ProductViewMode>(() => Taro.getStorageSync(PRODUCT_VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list')
  const [catalog, setCatalog] = useState<Product[]>(runtimeConfig.demoMode ? products : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState('1')
  const quantityValue = Math.min(999, Math.max(1, Number(quantity) || 1))
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [showPatternStory, setShowPatternStory] = useState(false)
  const [linking, setLinking] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [importTask, setImportTask] = useState<ImportTask | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const cart = useCart()
  const selectedStory = selectedProduct ? getPatternStory(selectedProduct) : null
  const selectedGalleryImages = useMemo(() => {
    const images = (selectedProduct?.images || []).filter((image) => isAvailableProductImage(image.fileId))
    const highDefinitionImages = images.filter((image) => /^(https:\/\/|cloud:\/\/)/.test(image.fileId))
    return highDefinitionImages.length ? highDefinitionImages : images
  }, [selectedProduct])

  const loadCatalog = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true)
    setLoadError(null)
    const devScenario = readDevScenario()
    if (devScenario === 'error') {
      setCatalog([]); setLoading(false); setLoadError({ message: '开发测试：模拟网络连接失败', requestId: 'DEV-NETWORK-ERROR' }); return
    }
    if (devScenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 3000))
    try {
      const result = await bootstrapApp()
      if (!result) return
      setCatalog(devScenario === 'empty' ? [] : withLocalProductCovers(result.products))
      cart.setItems(result.cart)
    } catch (error) {
      setCatalog([])
      setLoadError(requestErrorDetails(error, '商品加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCatalog() }, [loadCatalog])

  useEffect(() => {
    if (!isCloudReady()) return
    const timer = setTimeout(() => syncCart(cart.items).catch(() => undefined), 500)
    return () => clearTimeout(timer)
  }, [cart.items])

  const visibleProducts = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return catalog.filter((item) => {
      if (!productMatchesCategory(item, activeCategory)) return false
      return !query || `${item.code}${item.name}${item.colors.join('')}`.toLowerCase().includes(query)
    })
  }, [activeCategory, catalog, keyword])

  const categoryCounts = useMemo(() => new Map(productCategories.map((category) => [
    category.id,
    catalog.filter((product) => productMatchesCategory(product, category.id)).length
  ])), [catalog])

  const activeCategoryLabel = productCategories.find((category) => category.id === activeCategory)?.label || '全部'

  const openSpec = (product: Product) => {
    setSelectedProduct(product)
    setColor(product.colors[0])
    setSize(product.sizes[0])
    setQuantity('1')
    setGalleryIndex(0)
    setShowPatternStory(false)
  }

  const changeViewMode = (mode: ProductViewMode) => {
    setViewMode(mode)
    Taro.setStorageSync(PRODUCT_VIEW_MODE_KEY, mode)
  }

  const previewProductImage = (index: number) => {
    if (!selectedGalleryImages.length) return
    previewProductImages(selectedGalleryImages, index)
  }

  const closeSpec = () => {
    setShowPatternStory(false)
    setSelectedProduct(null)
  }

  const finishImport = async (taskId: string) => {
    const task = await waitForImport(taskId, 30000, setImportTask)
    const result = await applyImportTask(task.id)
    cart.mergeImport(result.items)
    Taro.showToast({ title: task.status === 'review' ? '已导入，请核对标黄项目' : '已加入订货车', icon: 'none' })
  }

  const importScreenshots = async () => {
    if (!isCloudReady()) {
      Taro.showToast({ title: '云开发配置后即可上传识别', icon: 'none' })
      return
    }
    try {
      const selected = await Taro.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album', 'camera'] })
      setImportBusy(true)
      const fileIds = await uploadImportImages(selected.tempFiles.map((file) => file.tempFilePath))
      const task = await createImportTask({ source: 'screenshot', fileIds })
      setImportTask(task)
      await finishImport(task.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '截图导入失败'
      if (!message.includes('cancel') && !message.includes('任务已提交')) Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setImportBusy(false)
    }
  }

  const importLink = async () => {
    if (!shareUrl.trim()) {
      Taro.showToast({ title: '请粘贴慧策分享链接', icon: 'none' })
      return
    }
    if (!isCloudReady()) {
      Taro.showToast({ title: '云开发配置后即可识别链接', icon: 'none' })
      return
    }
    setImportBusy(true)
    try {
      const task = await createImportTask({ source: 'link', url: shareUrl.trim() })
      setImportTask(task)
      await finishImport(task.id)
      setLinking(false)
      setShareUrl('')
    } catch (error) {
      const message = error instanceof Error ? error.message : '链接导入失败'
      if (!message.includes('任务已提交')) Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <>
      <AppHeader title='档口订货' subtitle='关联档口：示例档口' />
      <View className='page customer-order'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadCatalog} />
        {!loading && !loadError && <>
        <View className='customer-order__brandline'><Text>示例档口 · 源头档口</Text><Text>高清实拍 · 批发订货</Text></View>
        <View className='search-box'>
          <Text>⌕</Text>
          <Input className='search-input' value={keyword} onInput={(event) => setKeyword(event.detail.value)} placeholder='搜索款号、颜色' />
        </View>

        <View className='import-grid'>
          <View className='import-card' onClick={importScreenshots}>
            <Text className='import-card__icon'>▧</Text>
            <Text className='import-card__title'>截图导单</Text>
            <Text className='sub'>拍照或上传订单截图</Text>
          </View>
          <View className='import-card' onClick={() => setLinking(true)}>
            <Text className='import-card__icon'>🔗</Text>
            <Text className='import-card__title'>链接导单</Text>
            <Text className='sub'>粘贴慧策分享链接</Text>
          </View>
        </View>

        <View className='row between customer-order__heading'>
          <Text className='section-title'>{activeCategoryLabel} · {visibleProducts.length}款</Text>
          <View className='product-view-toggle'>
            <Text className={viewMode === 'list' ? 'active' : ''} onClick={() => changeViewMode('list')}>☰ 单列</Text>
            <Text className={viewMode === 'grid' ? 'active' : ''} onClick={() => changeViewMode('grid')}>▦ 双列</Text>
          </View>
        </View>
        <View className='catalog-layout'>
          <View className='category-sidebar'>
            {(['季节', '裤型'] as const).map((group) => (
              <View className='category-sidebar__group' key={group}>
                <Text className='category-sidebar__title'>{group}</Text>
                {productCategories.filter((category) => category.group === group && !(group === '裤型' && category.id === 'all')).map((category) => (
                  <View
                    key={category.id}
                    className={`category-sidebar__item ${activeCategory === category.id ? 'active' : ''}`}
                    onClick={() => setActiveCategory(category.id)}
                  >
                    <Text>{category.label}</Text>
                    <Text className='category-sidebar__count'>{categoryCounts.get(category.id) || 0}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <View className={`product-list product-list--${viewMode}`}>
            {visibleProducts.map((product) => <ProductCard key={product.id} product={product} layout={viewMode} onSelect={openSpec} />)}
            {!visibleProducts.length && <View className='catalog-empty'><Text>当前分类没有匹配商品</Text><Text>请更换分类或搜索词</Text></View>}
          </View>
        </View>

        <View className='cart-bar' onClick={() => Taro.navigateTo({ url: '/pages/customer/cart/index' })}>
          <View className='cart-bar__icon'><Text className='cart-bar__cart-glyph'>订</Text><Text className='cart-bar__badge'>{cart.count}</Text></View>
          <View className='grow'>
            <Text className='cart-bar__amount'>¥{cart.total}</Text>
            <Text className='cart-bar__hint'>截图、链接和手动选购已合并</Text>
          </View>
          <Text className='cart-bar__go'>去确认</Text>
        </View>
        </>}
      </View>
      <BottomNav role='customer' active='order' />

      {selectedProduct && (
        <View className='sheet-mask' onClick={closeSpec}>
          <View className='sheet spec-sheet' onClick={(event) => event.stopPropagation()}>
            {showPatternStory && selectedStory ? (
              <PatternStory product={selectedProduct} story={selectedStory} onBack={() => setShowPatternStory(false)} />
            ) : (
              <>
                <View className='row between'><Text className='title'>选择规格</Text><Text className='spec-sheet__close' onClick={closeSpec}>×</Text></View>
                {selectedGalleryImages.length ? (
                  <View className='spec-sheet__gallery-wrap'>
                    <Swiper className='spec-sheet__gallery-swiper' current={galleryIndex} onChange={(event) => setGalleryIndex(event.detail.current)} circular={selectedGalleryImages.length > 1}>
                      {selectedGalleryImages.map((image, index) => <SwiperItem key={`${image.fileId}-${index}`}><GalleryImage fileId={image.fileId} onClick={() => previewProductImage(index)} /></SwiperItem>)}
                    </Swiper>
                    <Text className='spec-sheet__gallery-tip'>点击放大 · 长按保存</Text>
                    <Text className='spec-sheet__save' onClick={() => saveProductImage(selectedGalleryImages[galleryIndex]?.fileId || '')}>保存高清图</Text>
                    <Text className='spec-sheet__gallery-label'>{({ cover: '封面图', detail: '实物图', package: '打包图', display: '展示图' } as const)[selectedGalleryImages[galleryIndex]?.type || 'detail']} · {galleryIndex + 1}/{selectedGalleryImages.length}</Text>
                  </View>
                ) : (
                  <View className={`spec-sheet__gallery ${selectedProduct.tone}`}><Text>暂无实物图</Text><Text>{selectedProduct.code}</Text></View>
                )}
                <View className='pattern-story-entry row between' onClick={() => setShowPatternStory(true)}>
                  <View><Text className='pattern-story-entry__title'>纹样与设计解读 · {selectedStory?.title}</Text><Text className='pattern-story-entry__sub'>点击热点，聚焦查看纹样、面料或裤型细节</Text></View>
                  <Text className='pattern-story-entry__go'>查看 ›</Text>
                </View>
                <Text className='sub'>花色</Text>
                <View className='chips'>{selectedProduct.colors.map((item) => <Text key={item} className={`chip ${color === item ? 'active' : ''}`} onClick={() => setColor(item)}>{item}</Text>)}</View>
                <Text className='sub'>尺码</Text>
                <View className='chips'>{selectedProduct.sizes.map((item) => <Text key={item} className={`chip ${size === item ? 'active' : ''}`} onClick={() => setSize(item)}>{item}</Text>)}</View>
                <View className='row between spec-sheet__quantity'><Text>数量</Text><View className='row'><Text className='quantity-step' onClick={() => setQuantity(String(Math.max(1, quantityValue - 1)))}>−</Text><Input className='quantity-input' type='number' value={quantity} maxlength={3} confirmType='done' placeholder='数量' onInput={(event) => { const value = event.detail.value; if (/^\d{0,3}$/.test(value)) setQuantity(value); else return quantity }} onBlur={() => setQuantity(String(quantityValue))} onConfirm={() => setQuantity(String(quantityValue))} /><Text className='quantity-step' onClick={() => setQuantity(String(Math.min(999, (Number(quantity) || 0) + 1)))}>＋</Text></View></View>
                <Button className='primary-btn' onClick={() => {
                  const existing = cart.items.filter((item) => item.productCode === selectedProduct.code && item.color === color && item.size === size).reduce((sum, item) => sum + item.quantity, 0)
                  if (existing + quantityValue > 999) return Taro.showToast({ title: '该花色尺码合计最多 999 件', icon: 'none' })
                  cart.addProduct(selectedProduct, color, size, quantityValue)
                  closeSpec()
                  Taro.showToast({ title: '已加入订货车' })
                }}>加入订货车</Button>
              </>
            )}
          </View>
        </View>
      )}

      {linking && (
        <View className='sheet-mask' onClick={() => setLinking(false)}>
          <View className='sheet link-sheet' onClick={(event) => event.stopPropagation()}>
            <View className='row between'><Text className='title'>链接导单</Text><Text onClick={() => setLinking(false)}>×</Text></View>
            <Text className='sub'>粘贴慧策 ERP 的公开分享链接，识别完成后直接合并到订货车。</Text>
            <Input className='link-sheet__input' value={shareUrl} onInput={(event) => setShareUrl(event.detail.value)} placeholder='https://erp.huice.com/public/share/…' />
            <Button className='ghost-btn' onClick={async () => {
              try { const result = await Taro.getClipboardData(); setShareUrl(result.data); Taro.showToast({ title: '已粘贴' }) }
              catch { Taro.showToast({ title: '无法读取剪贴板', icon: 'none' }) }
            }}>从剪贴板粘贴</Button>
            <Button loading={importBusy} disabled={importBusy} className='primary-btn' onClick={importLink}>识别并加入订货车</Button>
          </View>
        </View>
      )}

      {importTask && (
        <View className='sheet-mask' onClick={() => !importBusy && setImportTask(null)}>
          <View className='sheet import-progress' onClick={(event) => event.stopPropagation()}>
            <View className='row between'><Text className='title'>{importTask.source === 'screenshot' ? '截图导单' : '链接导单'}</Text><Text onClick={() => !importBusy && setImportTask(null)}>×</Text></View>
            <View className={`import-progress__icon ${importTask.status}`}><Text>{importTask.status === 'failed' ? '!' : importTask.status === 'completed' || importTask.status === 'review' ? '✓' : '识'}</Text></View>
            <Text className='import-progress__message'>{importTask.message || '任务已提交'}</Text>
            <View className='import-progress__bar'><View style={{ width: `${Math.max(6, importTask.progress || 0)}%` }} /></View>
            <Text className='mini'>任务号：{importTask.id.slice(-10)}</Text>
            {importTask.status === 'queued' && <Text className='sub import-progress__tip'>正在等待示例档口本地识别服务。关闭后任务仍会保留。</Text>}
            {!importBusy && <Button className='ghost-btn' onClick={() => setImportTask(null)}>关闭</Button>}
          </View>
        </View>
      )}
    </>
  )
}
