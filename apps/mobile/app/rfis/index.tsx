import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { rfiService, formatRelative } from '@esite/shared'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing } from '../../src/theme'

const RFI_STATUS: Record<string, { bg: string; fg: string; border: string }> = {
  draft:     { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
  open:      { bg: colors.redDim,   fg: colors.red,     border: colors.redMid },
  responded: { bg: colors.blueDim,  fg: colors.blue,    border: colors.blueMid },
  closed:    { bg: colors.greenDim, fg: colors.green,   border: colors.greenMid },
}

export default function RfiListScreen() {
  const router = useRouter()
  const client = useSupabase()
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const { data: rfis, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['rfis-org', orgId],
    queryFn: async () => {
      const { data: projects } = await client
        .schema('projects')
        .from('projects')
        .select('id')
        .eq('organisation_id', orgId)
        .eq('status', 'active')

      if (!projects?.length) return []

      const allRfis = await Promise.all(
        projects.map(p => rfiService.list(client, p.id).catch(() => []))
      )
      return allRfis.flat().sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    },
    enabled: !!orgId,
  })

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rfis ?? []}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.amber} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.screenTitle}>RFIs</Text>
            <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/rfis/create' as any)}>
              <Text style={styles.newBtnText}>+ New</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>❓</Text>
            <Text style={styles.emptyTitle}>No RFIs yet</Text>
            <Text style={styles.emptySubtitle}>Raise a Request for Information on any active project.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = RFI_STATUS[item.status] ?? RFI_STATUS.draft
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/rfis/${item.id}` as any)}
              activeOpacity={0.7}
            >
              <View style={styles.cardTop}>
                <View style={[styles.priorityDot, { backgroundColor: priorityColor(item.priority) }]} />
                <Text style={styles.cardTitle} numberOfLines={2}>{item.subject}</Text>
                <View style={[styles.statusBadge, { backgroundColor: status.bg, borderColor: status.border }]}>
                  <Text style={[styles.statusText, { color: status.fg }]}>{item.status}</Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>{formatRelative(item.created_at)}</Text>
                {item.due_date && <Text style={styles.dueText}>Due {item.due_date}</Text>}
              </View>
            </TouchableOpacity>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, gap: spacing.sm + 2 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  screenTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  newBtn: { backgroundColor: colors.amber, paddingHorizontal: spacing.md + 2, paddingVertical: 7, borderRadius: radius.pill },
  newBtnText: { color: colors.base, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg - 2, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  cardTitle: { flex: 1, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text, lineHeight: 18 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.md, borderWidth: 1, flexShrink: 0 },
  statusText: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  metaText: { fontSize: fontSize.caption, color: colors.textDim },
  dueText: { fontSize: fontSize.caption, color: colors.amber },
  empty: { padding: 40, alignItems: 'center', gap: spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  emptySubtitle: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center' },
})
