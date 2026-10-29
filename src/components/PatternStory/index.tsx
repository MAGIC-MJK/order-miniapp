import { useEffect, useMemo, useState } from 'react'
import { Image, Text, View } from '@tarojs/components'
import type { Product } from '@/types'
import type { PatternStory as PatternStoryData } from '@/data/patternStories'
import { productHighDefinitionCandidates } from '@/utils/productImages'
import './index.scss'

interface Props {
  product: Product
  story: PatternStoryData
  onBack: () => void
}

export default function PatternStory({ product, story, onBack }: Props) {
  const [focusedHotspot, setFocusedHotspot] = useState<number | null>(null)
  const candidates = useMemo(() => productHighDefinitionCandidates(product), [product.images])
  const [imageIndex, setImageIndex] = useState(0)
  const image = candidates[imageIndex]
  const focused = focusedHotspot === null ? null : story.hotspots[focusedHotspot]
  const closeFocus = () => setFocusedHotspot(null)

  useEffect(() => setImageIndex(0), [product.code])

  return (
    <View className='pattern-story'>
      <View className='row between pattern-story__header'>
        <Text className='pattern-story__back' onClick={() => focused ? closeFocus() : onBack()}>‹ {focused ? '收起放大' : '返回选择规格'}</Text>
        <Text className='pattern-story__confidence'>视觉识别：{story.confidence}</Text>
      </View>

      <View className={`pattern-story__visual ${focused ? 'is-focused' : ''}`}>
        {image ? <Image className='pattern-story__photo' src={image} mode='aspectFit' lazyLoad showMenuByLongpress webp onError={() => setImageIndex((current) => Math.min(current + 1, candidates.length - 1))} /> : <View className='pattern-story__empty'>暂无商品图</View>}
        {story.hotspots.map((hotspot, index) => (
          <Text
            key={hotspot.label}
            className='pattern-story__hotspot'
            style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
            onClick={() => setFocusedHotspot(index)}
          >{index + 1}</Text>
        ))}
        {focused && (
          <>
            <View className='pattern-story__mask' onClick={closeFocus} />
            <View className='pattern-story__magnifier' style={{ left: `${focused.x}%`, top: `${focused.y}%` }}>
              <View className='pattern-story__magnifier-clip'>
                {image && (
                  <Image
                    className='pattern-story__magnified-photo'
                    src={image}
                    mode='scaleToFill'
                    style={{ left: `${50 - focused.x * 2.4}%`, top: `${50 - focused.y * 2.4}%` }}
                  />
                )}
              </View>
              <Text className='pattern-story__zoom-label'>纹样细节 ×2.4</Text>
            </View>
            <Text className='pattern-story__close-focus' onClick={closeFocus}>收起放大</Text>
          </>
        )}
        <Text className='pattern-story__caption'>{focused?.label || `款号 ${story.productCode} · 点击数字聚焦纹样`}</Text>
      </View>

      <View className='pattern-story__copy'>
        <View className='row between'>
          <Text className='pattern-story__title'>{story.title}</Text>
          <Text className='pattern-story__mood'>{story.mood}</Text>
        </View>
        <Text className='pattern-story__label'>图片观察</Text>
        <Text className='pattern-story__paragraph'>{story.observation}</Text>
        <Text className='pattern-story__label'>纹样含义</Text>
        <Text className='pattern-story__paragraph'>{story.interpretation}</Text>
        <View className='pattern-story__selling row between'><Text>商品表达建议</Text><Text>{story.sellingPoint}</Text></View>
        <Text className='pattern-story__disclaimer'>含义基于商品实拍图的形态、色彩和材质视觉进行解析；纯色或光泽面料只解读视觉气质，不虚构传统寓意。具体材质、工艺和历史来源仍以档口实物与供应商资料为准。</Text>
      </View>
    </View>
  )
}
