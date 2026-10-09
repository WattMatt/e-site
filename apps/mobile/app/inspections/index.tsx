// apps/mobile/app/inspections/index.tsx
//
// List of in-flight inspections, read from Supabase as the signed-in user (RLS
// applies; same scope as the org_inspections sync bucket). Two filter modes:
//   - "Assigned to me" — current user's queue
//   - "All"            — every active inspection the user can see
//
// Rows with changes still waiting in this device's outbox carry a badge.
// Reloads whenever the screen regains focus (e.g. back from a submit).
//
// Tapping a card opens the capture screen at /inspections/[inspectionId].

import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Link, useFocusEffect } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { inspectionRemote } from '../../src/inspections/outbox-worker'
import { countsByInspection } from '../../src/inspections/response-outbox'
import { powerSyncExecutor } from '../../src/lib/powersync/executor'
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
type Unsent = Record<string, { waiting: number; rejected: number }>

const STATUS_BADGE: Record<string, { bg: string; fg: string; border: string }> = {
  assigned: { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
  in_progress: { bg: colors.amberDim, fg: colors.amber, border: colors.amberMid },
  awaiting_verification: { bg: colors.blueDim, fg: colors.blue, border: colors.blueMid },
  're-inspect_required': { bg: colors.redDim, fg: colors.red, border: colors.redMid },
  certified: { bg: colors.greenDim, fg: colors.green, border: colors.greenMid },
  abandoned: { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
}

// "Assigned to me": soonest scheduled first, unscheduled last.
function byScheduled(a: Row, b: Row): number {
  if (!a.scheduled_at && !b.scheduled_at) return 0
  if (!a.scheduled_at) return 1
  if (!b.scheduled_at) return -1
  return a.scheduled_at.localeCompare(b.scheduled_at)
}

export default function InspectionsListScreen() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [items, setItems] = useState<Row[]>([])
  const [unsent, setUnsent] = useState<Unsent>({})
  const [filter, setFilter] = useState<Filter>('assigned_to_me')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      setLoading(true)
      setError(null)
      ;(async () => {
        try {
          const mine = filter === 'assigned_to_me' && !!userId
          const rows = await inspectionRemote.listInspections(mine ? { assignedTo: userId } : {})
          const counts = await countsByInspection(powerSyncExecutor).catch(() => ({}) as Unsent)
          if (cancelled) return
          setItems(mine ? [...rows].sort(byScheduled) : rows)
          setUnsent(counts)
        } catch (e) {
          if (!cancelled) setError((e as Error).message ?? String(e))
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [filter, userId]),
  )

  const renderItem = useCallback(({ item }: { item: Row }) => {
    const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.assigned
    const local = unsent[item.id]
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
          {local?.rejected ? (
            <Text style={[styles.metaText, { color: colors.red }]}>
              {local.rejected} change{local.rejected === 1 ? '' : 's'} refused — open to review
            </Text>
          ) : local?.waiting ? (
            <Text style={[styles.metaText, { color: colors.amber }]}>
              {local.waiting} change{local.waiting === 1 ? '' : 's'} waiting to upload
            </Text>
          ) : null}
        </TouchableOpacity>
      </Link>
    )
  }, [unsent])

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
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Could not load inspections. Check your connection.</Text>
          <Text style={styles.metaText}>{error}</Text>
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
