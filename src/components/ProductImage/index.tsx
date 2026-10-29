import { useEffect, useMemo, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import type { ProductImage as ProductImageType } from '@/types'
import { productImageCandidates } from '@/utils/productImages'
import './index.scss'

type ProductImageProps = {
  code: string
  images?: ProductImageType[]
  className?: string
  preferHd?: boolean
  showCode?: boolean
  onClick?: () => void
}

export default function ProductImage({ code, images, className = '', preferHd = false, showCode = true, onClick }: ProductImageProps) {
  const candidates = useMemo(() => {
    const cover = images?.find((image) => image.type === 'cover')?.fileId
    const hd = images?.find((image) => /^https:\/\//.test(image.fileId) && image.type === 'display')?.fileId
      || images?.find((image) => /^(https:\/\/|cloud:\/\/)/.test(image.fileId))?.fileId
    const sources = (preferHd ? [hd, cover] : [cover, hd]).filter(Boolean) as string[]
    return [...new Set(sources.flatMap(productImageCandidates))]
  }, [images, preferHd])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const source = candidates[candidateIndex]
  const exhausted = candidateIndex >= candidates.length

  useEffect(() => {
    setCandidateIndex(0)
    setLoaded(false)
  }, [candidates.join('|')])

  return (
    <View className={`product-image ${loaded ? 'is-loaded' : ''} ${className}`} onClick={onClick}>
      {!loaded && source && !exhausted && <View className='product-image__skeleton' />}
      {source && !exhausted
        ? <Image
            src={source}
            mode='aspectFit'
            lazyLoad
            fadeIn
            showMenuByLongpress
            webp
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false)
              setCandidateIndex((current) => current + 1 < candidates.length ? current + 1 : candidates.length)
            }}
          />
        : <View className='product-image__empty'><Text>{candidates.length ? '图片加载失败' : '暂无图片'}</Text></View>}
      {showCode && <Text className='product-image__code'>{code}</Text>}
    </View>
  )
}
