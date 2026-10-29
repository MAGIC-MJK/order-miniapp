import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Button, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import AppHeader from '@/components/AppHeader'
import BottomNav from '@/components/BottomNav'
import ProductImage from '@/components/ProductImage'
import PageState from '@/components/PageState'
import { runtimeConfig } from '@/config/runtime'
import { products, withLocalProductCovers } from '@/data/mock'
import { bootstrapApp, isCloudReady, requestErrorDetails, saveProduct, seedDatabase, uploadFiles } from '@/services/cloud'
import type { Product, ProductImage as ProductImageData } from '@/types'
import { previewProductImages } from '@/utils/productImages'
import './index.scss'

const LOCAL_DRAFTS_KEY = 'yangge_product_drafts_v1'

function loadLocalDrafts() {
  try {
    return Taro.getStorageSync<Product[]>(LOCAL_DRAFTS_KEY) || []
  } catch {
    return []
  }
}

function imageTypeForIndex(index: number): ProductImageData['type'] {
  if (index === 0) return 'cover'
  if (index === 1) return 'package'
  return 'display'
}

function imageTypeLabel(type: ProductImageData['type']) {
  return ({ cover: '封面/实物', package: '打包图', display: '展示图', detail: '详情图' })[type]
}

export default function StallListingPage() {
  const [tab, setTab] = useState('sale')
  const [keyword, setKeyword] = useState('')
  const [viewMode, setViewMode] = useState<'single' | 'double'>('single')
  const [editing, setEditing] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [catalog, setCatalog] = useState<Product[]>(() => runtimeConfig.demoMode ? [...loadLocalDrafts(), ...products] : [])
  const [loading, setLoading] = useState(!runtimeConfig.demoMode)
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null)
  const [form, setForm] = useState({ code: '', name: '', price: '', colors: '', sizes: '', stock: '' })
  const [images, setImages] = useState<ProductImageData[]>([])
  const [pendingImagePaths, setPendingImagePaths] = useState<string[]>([])

  const loadCatalog = useCallback(async () => {
    if (!isCloudReady()) return
    setLoading(true); setLoadError(null)
    try {
      const result = await bootstrapApp()
      if (!result) return
      setCatalog(withLocalProductCovers(result.products))
      if (!result.products.length) {
        const confirm = await Taro.showModal({ title: '初始化商品目录', content: '云数据库还是空的，是否导入示例档口当前 80 款商品？' })
        if (confirm.confirm) {
          await seedDatabase()
          const refreshed = await bootstrapApp()
          if (refreshed) setCatalog(withLocalProductCovers(refreshed.products))
        }
      }
    } catch (error) {
      setCatalog([]); setLoadError(requestErrorDetails(error, '商品资料加载失败'))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  const visibleProducts = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return catalog.filter((product) => (product.status || 'sale') === tab)
      .filter((product) => !query || `${product.code}${product.name}${product.colors.join('')}`.toLowerCase().includes(query))
  }, [catalog, keyword, tab])

  const updateForm = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const importFullCatalog = async () => {
    const confirm = await Taro.showModal({
      title: '导入示例档口商品',
      content: '将按款号补齐缺失商品；已有商品资料、库存和图片不会改动。是否继续？'
    })
    if (!confirm.confirm) return
    Taro.showLoading({ title: '正在导入商品', mask: true })
    try {
      const result = await seedDatabase()
      const refreshed = await bootstrapApp()
      if (refreshed) setCatalog(withLocalProductCovers(refreshed.products))
      Taro.showToast({ title: `已同步 ${result.seeded} 款商品`, icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '商品导入失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const openEditor = (product?: Product) => {
    setEditingId(product?.id || '')
    setForm(product ? {
      code: product.code,
      name: product.name,
      price: String(product.price),
      colors: product.colors.join('、'),
      sizes: product.sizes.join('、'),
      stock: String(product.stockReference)
    } : { code: '', name: '', price: '', colors: '', sizes: '', stock: '' })
    setImages(product?.images || [])
    setPendingImagePaths([])
    setEditing(true)
  }

  const choosePhotos = async (replaceIndex?: number) => {
    try {
      const remaining = Math.max(1, 30 - images.length)
      const selected = await Taro.chooseMedia({ count: replaceIndex === undefined ? Math.min(9, remaining) : 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
      const paths = selected.tempFiles.map((file) => file.tempFilePath)
      if (!paths.length) return
      const replacedPath = replaceIndex === undefined ? '' : images[replaceIndex]?.fileId
      setImages((current) => {
        if (replaceIndex !== undefined) {
          const next = [...current]
          next[replaceIndex] = { fileId: paths[0], type: current[replaceIndex]?.type || imageTypeForIndex(replaceIndex) }
          return next
        }
        return [...current, ...paths.map((fileId, offset) => ({ fileId, type: imageTypeForIndex(current.length + offset) }))]
      })
      setPendingImagePaths((current) => [...current.filter((path) => path !== replacedPath), ...paths])
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择图片失败'
      if (!message.includes('cancel')) Taro.showToast({ title: message, icon: 'none' })
    }
  }

  const removePhoto = (index: number) => {
    const removed = images[index]
    setImages((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index)
      if (next.length && !next.some((image) => image.type === 'cover')) next[0] = { ...next[0], type: 'cover' }
      return next
    })
    if (removed) setPendingImagePaths((current) => current.filter((path) => path !== removed.fileId))
  }

  const prepareImages = async () => {
    if (!pendingImagePaths.length) return images
    if (isCloudReady()) {
      const uploaded = await uploadFiles(pendingImagePaths, 'products')
      const uploadedByPath = new Map(pendingImagePaths.map((path, index) => [path, uploaded[index]]))
      return images.map((image) => ({ ...image, fileId: uploadedByPath.get(image.fileId) || image.fileId }))
    }
    const savedByPath = new Map<string, string>()
    await Promise.all(pendingImagePaths.map(async (path) => {
      try {
        const result = await Taro.saveFile({ tempFilePath: path })
        if ('savedFilePath' in result) savedByPath.set(path, result.savedFilePath)
        else savedByPath.set(path, path)
      } catch {
        savedByPath.set(path, path)
      }
    }))
    return images.map((image) => ({ ...image, fileId: savedByPath.get(image.fileId) || image.fileId }))
  }

  const saveProductWithStatus = async (status: 'sale' | 'draft') => {
    const price = Number(form.price)
    const stockReference = Number(form.stock)
    if (status === 'sale' && (!form.code.trim() || !form.name.trim() || !price || !form.colors.trim() || !form.sizes.trim())) {
      Taro.showToast({ title: '请完整填写款号、名称、价格、花色和尺码', icon: 'none' })
      return
    }
    if (status === 'draft' && !form.code.trim() && !form.name.trim() && !images.length) {
      Taro.showToast({ title: '请至少填写款号、名称或添加一张图片', icon: 'none' })
      return
    }
    Taro.showLoading({ title: status === 'draft' ? '正在保存草稿' : '正在上架', mask: true })
    try {
      const productImages = await prepareImages()
      const product: Product = {
        id: editingId || (status === 'draft' ? `draft-${Date.now()}` : ''),
        code: form.code.trim(),
        name: form.name.trim(),
        price: Number.isFinite(price) ? price : 0,
        colors: form.colors.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean),
        sizes: form.sizes.split(/[、,，/\-]/).map((item) => item.trim().toUpperCase()).filter(Boolean),
        stockReference: Number.isFinite(stockReference) ? stockReference : 0,
        tone: 'cream',
        status,
        images: productImages
      }
      if (isCloudReady()) {
        const result = await saveProduct(product)
        product.id = result.productId
      } else if (status === 'sale' && !product.id) {
        product.id = `demo-${Date.now()}`
      }
      setCatalog((current) => {
        const next = editingId ? current.map((item) => item.id === editingId ? product : item) : [product, ...current]
        if (!isCloudReady()) Taro.setStorageSync(LOCAL_DRAFTS_KEY, next.filter((item) => item.status === 'draft'))
        return next
      })
      setEditing(false)
      setEditingId('')
      setForm({ code: '', name: '', price: '', colors: '', sizes: '', stock: '' })
      setImages([])
      setPendingImagePaths([])
      if (status === 'draft') setTab('draft')
      Taro.showToast({ title: status === 'draft' ? '草稿已保存，可继续编辑' : editingId ? '商品已更新并同步客户' : '商品已上架并同步客户', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : status === 'draft' ? '草稿保存失败' : '商品上架失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const changeProductStatus = async (product: Product, status: 'sale' | 'off') => {
    const next = { ...product, status }
    Taro.showLoading({ title: status === 'off' ? '正在下架' : '正在上架', mask: true })
    try {
      if (isCloudReady()) await saveProduct(next)
      setCatalog((current) => current.map((item) => item.id === product.id ? next : item))
      Taro.showToast({ title: status === 'off' ? '已下架并同步客户' : '已重新上架', icon: 'none' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '状态更新失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  return (
    <>
      <AppHeader title='上架' subtitle='示例档口' />
      <View className='page listing-page'>
        <PageState loading={loading} error={loadError?.message} requestId={loadError?.requestId} onRetry={loadCatalog} />
        {!loading && !loadError && <>
        {isCloudReady() && <View className='listing-page__import row between'><View><Text className='listing-page__import-title'>示例档口商品资料</Text><Text className='sub'>本地已整理 80 款，可补齐云端缺失款式</Text></View><Button onClick={importFullCatalog}>补齐款式</Button></View>}
        <View className='listing-toolbar'>
          <View className='search-box'><Text>⌕</Text><Input className='search-input' value={keyword} onInput={(event) => setKeyword(event.detail.value)} placeholder='搜索款号、商品名称' /></View>
          <View className='listing-view-switch'>
            <Text className={viewMode === 'single' ? 'active' : ''} onClick={() => setViewMode('single')}>一列</Text>
            <Text className={viewMode === 'double' ? 'active' : ''} onClick={() => setViewMode('double')}>双列</Text>
          </View>
        </View>
        <View className='tabs'>
          {[['sale', `售卖中 ${catalog.filter((item) => (item.status || 'sale') === 'sale').length}`], ['draft', `草稿 ${catalog.filter((item) => item.status === 'draft').length}`], ['off', `已下架 ${catalog.filter((item) => item.status === 'off').length}`]].map(([key, label]) => <View key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</View>)}
        </View>

        <View className={`listing-grid listing-grid--${viewMode}`}>
        {visibleProducts.map((product) => (
          <View key={product.id} className='card listing-item'>
            <ProductImage className={`listing-item__photo ${product.tone}`} code={product.code || '草稿'} images={product.images} onClick={() => previewProductImages(product.images)} />
            <View className='grow'>
              <View className='row between'><Text className='listing-item__name'>{product.code || '未填款号'} {product.name || '未命名商品'}</Text><Text className={`pill ${product.status === 'sale' ? 'green' : product.status === 'draft' ? 'yellow' : ''}`}>{product.status === 'draft' ? '草稿' : product.status === 'off' ? '已下架' : '售卖中'}</Text></View>
              <Text className='sub'>{product.colors.length ? product.colors.join(' / ') : '花色待填写'}</Text>
              <Text className='listing-item__stock'>{product.price > 0 ? `¥${product.price}` : '价格待填写'} · 参考总库存 {product.stockReference}</Text>
              <View className='row listing-item__actions'><Text className='pill' onClick={() => openEditor(product)}>{product.status === 'draft' ? '继续编辑' : '编辑'}</Text>{product.status !== 'draft' && <Text className='pill' onClick={() => changeProductStatus(product, tab === 'sale' ? 'off' : 'sale')}>{tab === 'sale' ? '下架' : '重新上架'}</Text>}</View>
            </View>
          </View>
        ))}
        </View>
        {!visibleProducts.length && <PageState empty emptyTitle='暂无商品' emptyDescription={keyword ? '没有匹配的款号或商品名称' : '点击右下角加号上架第一款商品'} />}
        <Button className='fab' onClick={() => openEditor()}>＋</Button>
        </>}
      </View>
      <BottomNav role='stall' active='listing' />

      {editing && (
        <View className='sheet-mask' onClick={() => setEditing(false)}>
          <View className='sheet listing-sheet' onClick={(event) => event.stopPropagation()}>
            <View className='row between'><Text className='title'>{editingId ? '编辑商品' : '新增商品'}</Text><Text onClick={() => setEditing(false)}>×</Text></View>
            <Text className='listing-sheet__photo-title'>商品图片 <Text>点击图片可预览，支持替换或删除</Text></Text>
            <View className='listing-sheet__photos'>
              {images.map((image, index) => (
                <View key={`${image.fileId}-${index}`} className='listing-sheet__photo'>
                  <Image src={image.fileId} mode='aspectFit' onClick={() => previewProductImages(images, index)} />
                  <Text className='listing-sheet__photo-type'>{imageTypeLabel(image.type)}</Text>
                  <View className='listing-sheet__photo-actions'><Text onClick={() => choosePhotos(index)}>替换</Text><Text onClick={() => removePhoto(index)}>删除</Text></View>
                </View>
              ))}
              {images.length < 30 && <View className='listing-sheet__photo-add' onClick={() => choosePhotos()}><Text>＋</Text><Text>拍照/相册</Text></View>}
            </View>
            <View className='listing-sheet__field row'><Text>款号</Text><Input value={form.code} onInput={(event) => updateForm('code', event.detail.value)} placeholder='如 6630' /></View>
            <View className='listing-sheet__field row'><Text>商品名称</Text><Input value={form.name} onInput={(event) => updateForm('name', event.detail.value)} placeholder='如 冰丝直筒裤' /></View>
            <View className='listing-sheet__field row'><Text>销售价</Text><Input type='digit' value={form.price} onInput={(event) => updateForm('price', event.detail.value)} placeholder='如 60' /></View>
            <View className='listing-sheet__field row'><Text>花色</Text><Input value={form.colors} onInput={(event) => updateForm('colors', event.detail.value)} placeholder='米白、黑色、咖色' /></View>
            <View className='listing-sheet__field row'><Text>尺码</Text><Input value={form.sizes} onInput={(event) => updateForm('sizes', event.detail.value)} placeholder='L、XL、2XL、3XL、4XL' /></View>
            <View className='listing-sheet__field row'><Text>总库存</Text><Input type='number' value={form.stock} onInput={(event) => updateForm('stock', event.detail.value)} placeholder='参考总数' /></View>
            <View className='listing-sheet__footer'>
              {(!editingId || catalog.find((item) => item.id === editingId)?.status === 'draft') && <Button className='ghost-btn' onClick={() => saveProductWithStatus('draft')}>保存草稿</Button>}
              <Button className='primary-btn' onClick={() => saveProductWithStatus('sale')}>{editingId ? '保存并上架' : '上架并同步客户'}</Button>
            </View>
          </View>
        </View>
      )}
    </>
  )
}
