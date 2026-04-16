import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { EmptyStateConfig } from '../EmptyState'

interface Props extends Partial<EmptyStateConfig> {
  onAction?: () => void
}

/**
 * React Native EmptyStateView — renders empty state with optional action button.
 * Minimum touch target 44pt per spec (T-050 AC).
 */
export function EmptyStateView({
  icon = '📭',
  heading = 'Nothing here',
  body,
  actionLabel,
  onAction,
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.heading}>{heading}</Text>
      {body && <Text style={styles.body}>{body}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.btn} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  heading: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
  btn: {
    marginTop: 20,
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    // 44pt minimum touch target
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
})
