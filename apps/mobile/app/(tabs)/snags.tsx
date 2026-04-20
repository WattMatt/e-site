import { useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useQuery } from '@tanstack/react-query'
import { snagService, formatDate } from '@esite/shared'
import { useProjects } from '../../src/hooks/useProjects'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing, statusBadge } from '../../src/theme'

export default function SnagsTab() {
  const { profile } = useAuth()
  const client = useSupabase()
  const router = useRouter()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const { data: snags, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['snags-org', orgId],
    queryFn: () => snagService.listByOrg(client, orgId),
    enabled: !!orgId,
  })

  const { data: projects } = useProjects(orgId)
  const defaultProjectId = projects?.[0]?.id ?? ''

  const renderItem = useCallback(({ item }: { item: NonNullable<typeof snags>[number] }) => {
    const badge = statusBadge(item.status)
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/snags/${item.id}` as any)}
        activeOpacity={0.7}
      >
        <View style={styles.cardRow}>
          <View style={[styles.priorityDot, { backgroundColor: priorityColor(item.priority) }]} />
          <View style={styles.cardFlex}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>
              {(item as any).project?.name} · {item.location ?? 'No location'}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
            <Text style={[styles.statusText, { color: badge.fg }]}>{item.status.replace(/_/g, ' ')}</Text>
          </View>
        </View>
        <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
      </TouchableOpacity>
    )
  }, [router])

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.amber} /></View>
  }

  return (
    <View testID="snags-list-screen" style={styles.container}>
      <FlatList
        data={snags ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.amber} />}
        contentContainerStyle={styles.list}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.screenTitle}>Snags</Text>
            <TouchableOpacity
              style={styles.newBtn}
              onPress={() => router.push({ pathname: '/snags/create', params: { projectId: defaultProjectId } } as any)}
            >
              <Text style={styles.newBtnText}>+ New</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>⚠️</Text>
            <Text style={styles.emptyTitle}>No snags yet</Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.sm + 2 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  screenTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  newBtn: { backgroundColor: colors.amber, paddingHorizontal: spacing.md + 2, paddingVertical: 7, borderRadius: radius.pill },
  newBtnText: { color: colors.base, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.md + 2, borderWidth: 1, borderColor: colors.border },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  priorityDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  cardFlex: { flex: 1 },
  cardTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  cardSub: { fontSize: fontSize.caption, color: colors.textMid, marginTop: 2 },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1 },
  statusText: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  dateText: { fontSize: fontSize.caption, color: colors.textDim, marginTop: spacing.sm },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
})
