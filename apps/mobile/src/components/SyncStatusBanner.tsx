import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStatus } from '@powersync/react-native'
import { colors, fontSize, fontWeight, spacing } from '../theme'

export function SyncStatusBanner() {
  const status = useStatus()
  const insets = useSafeAreaInsets()

  const offline = !status.connected && !status.connecting
  const syncing =
    status.connecting ||
    status.dataFlowStatus.downloading ||
    status.dataFlowStatus.uploading

  if (!offline && !syncing) return null

  const palette = offline
    ? { bg: colors.redDim, fg: colors.red, border: colors.redMid }
    : { bg: colors.amberDim, fg: colors.amber, border: colors.amberMid }

  const label = offline
    ? 'Offline — viewing cached data'
    : status.hasSynced
      ? 'Syncing…'
      : 'Connecting — syncing for the first time…'

  return (
    <View
      pointerEvents="none"
      style={[
        styles.banner,
        {
          paddingTop: insets.top + spacing.xs,
          backgroundColor: palette.bg,
          borderBottomColor: palette.border,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="sync-status-banner"
    >
      <Text style={[styles.text, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold as '600',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
})
