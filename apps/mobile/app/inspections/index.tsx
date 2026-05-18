// apps/mobile/app/inspections/index.tsx
//
// List of inspections, read entirely from the locally synced PowerSync
// SQLite table (bucket: org_inspections). Two filter modes:
//   - "Assigned to me" — current user's queue
//   - "All"            — every active inspection on the org
//
// Tapping a card opens the capture screen at /inspections/[inspectionId].

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Link } from 'expo-router'
import { usePowerSync } from '@powersync/react-native'
import { useAuth } from '../../src/providers/AuthProvider'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

type Row = {
  id: string
  target_label: string | null
  status: string
  coc_number: string | null
  scheduled_at: string | null
  updated_at: string | null
}

type Filter = 'assigned_to_me' | 'all'

const STATUS_BADGE: Record<string, { bg: string; fg: string; border: string }> = {
  assigned: { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
  in_progress: { bg: colors.amberDim, fg: colors.amber, border: colors.amberMid },
  awaiting_verification: { bg: colors.blueDim, fg: colors.blue, border: colors.blueMid },
  're-inspect_required': { bg: colors.redDim, fg: colors.red, border: colors.redMid },
  certified: { bg: colors.greenDim, fg: colors.green, border: colors.greenMid },
  abandoned: { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
}

export default function InspectionsListScreen() {
  const db = usePowerSync()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [items, setItems] = useState<Row[]>([])
  const [filter, setFilter] = useState<Filter>('assigned_to_me')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const rs =
          filter === 'assigned_to_me' && userId
            ? await db.execute(
                `SELECT id, target_label, status, coc_number, scheduled_at, updated_at
                 FROM inspections
                 WHERE assigned_to_id = ?
                 ORDER BY scheduled_at IS NULL, scheduled_at ASC, updated_at DESC`,
                [userId],
              )
            : await db.execute(
                `SELECT id, target_label, status, coc_number, scheduled_at, updated_at
                 FROM inspections
                 ORDER BY updated_at DESC
                 LIMIT 100`,
              )
        if (cancelled) return
        const rows: Row[] =
          (rs.rows?._array as Row[] | undefined) ??
          ((rs.rows as unknown as Row[]) ?? [])
        setItems(rows)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [db, filter, userId])

  const renderItem = useCallback(({ item }: { item: Row }) => {
    const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.assigned
    return (
      <Link href={`/inspections/${item.id}`} asChild>
        <TouchableOpacity style={styles.card} activeOpacity={0.7}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.target_label ?? '(no label)'}
            </Text>
            <View
              style={[styles.statusBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}
            >
              <Text style={[styles.statusText, { color: badge.fg }]}>{item.status}</Text>
            </View>
          </View>
          {item.coc_number ? (
            <Text style={styles.metaText}>COC {item.coc_number}</Text>
          ) : null}
        </TouchableOpacity>
      </Link>
    )
  }, [])

  return (
    <View style={styles.container} testID="inspections-screen">
      <View style={styles.filterRow}>
        <TouchableOpacity
          onPress={() => setFilter('assigned_to_me')}
          style={[styles.filterChip, filter === 'assigned_to_me' && styles.filterChipActive]}
        >
          <Text
            style={[styles.filterText, filter === 'assigned_to_me' && styles.filterTextActive]}
          >
            Assigned to me
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setFilter('all')}
          style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.amber} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.listWrap}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {filter === 'assigned_to_me'
                ? 'No inspections assigned to you.'
                : 'No inspections yet.'}
            </Text>
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderMid,
    backgroundColor: colors.base,
  },
  filterChipActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  filterText: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium },
  filterTextActive: { color: colors.base },
  listWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyText: { color: colors.textMid, fontSize: fontSize.md, textAlign: 'center' },
  card: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderMid,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  statusText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  metaText: { color: colors.textMid, fontSize: fontSize.caption, marginTop: spacing.xs },
})
