import { useEffect, useRef } from 'react'
import { View, Animated, StyleSheet } from 'react-native'
import type { SkeletonKey } from '../LoadingSkeleton'
import { SKELETONS } from '../LoadingSkeleton'

interface Props {
  skeleton?: SkeletonKey
  count?: number
}

function SkeletonBlock({ width, height, borderRadius = 6 }: { width: number | string; height: number; borderRadius?: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start()
  }, [opacity])

  const w = typeof width === 'string' && width.endsWith('%')
    ? width
    : typeof width === 'number' ? width : 100

  return (
    <Animated.View
      style={[
        styles.block,
        { width: w as any, height, borderRadius, opacity },
      ]}
    />
  )
}

export function SkeletonLoader({ skeleton = 'listRow', count = 3 }: Props) {
  const config = SKELETONS[skeleton]

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          {config.shapes.map((shape, j) => (
            <SkeletonBlock
              key={j}
              width={shape.width ?? '100%'}
              height={typeof shape.height === 'number' ? shape.height : 16}
              borderRadius={shape.type === 'circle' ? 999 : (shape.borderRadius ?? 6)}
            />
          ))}
        </View>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  block: {
    backgroundColor: '#334155',
  },
})
