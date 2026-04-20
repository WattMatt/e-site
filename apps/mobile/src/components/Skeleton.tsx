import { useEffect, useRef } from 'react'
import { Animated, View, type ViewStyle } from 'react-native'
import { colors, radius } from '../theme'

/**
 * Mobile loading-state placeholder.
 *
 * RN doesn't give us CSS animations for free — we run a simple opacity
 * Animated.loop so rows pulse gently while data loads. Mirrors the web
 * `<Skeleton>` styling (amber-tinted warm-dark panel).
 */

interface Props {
  width?: number | string
  height?: number
  style?: ViewStyle
}

export function Skeleton({ width = '100%', height = 14, style }: Props) {
  const opacity = useRef(new Animated.Value(0.55)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius.sm,
          backgroundColor: colors.panel,
          opacity,
        },
        style,
      ]}
    />
  )
}

export function SkeletonRow({ showChevron = true }: { showChevron?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 12,
      }}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="40%" height={11} />
      </View>
      {showChevron && <Skeleton width={32} height={18} style={{ borderRadius: radius.md }} />}
    </View>
  )
}

export function SkeletonKpiCard() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: radius.lg,
        padding: 14,
        gap: 8,
      }}
    >
      <Skeleton width="55%" height={10} />
      <Skeleton width="35%" height={26} />
    </View>
  )
}
