import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { rfiService, formatRelative } from '@esite/shared'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'

const STATUS_COLORS: Record<string, string> = {
  draft: '#475569', open: '#EF4444', responded: '#3B82F6', closed: '#10B981',
}
const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}

export default function RfiListScreen() {
  const router = useRouter()
  const client = useSupabase()
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  // Fetch RFIs across all projects in org
  const { data: rfis, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['rfis-org', orgId],
    queryFn: async () => {
      // Get all projects for org, then fetch RFIs
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
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rfis ?? []}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3B82F6" />}
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
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/rfis/${item.id}` as any)}
            activeOpacity={0.7}
          >
            <View style={styles.cardTop}>
              <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] ?? '#6B7280' }]} />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.subject}</Text>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '22', borderColor: STATUS_COLORS[item.status] }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>{item.status}</Text>
              </View>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.metaText}>{formatRelative(item.created_at)}</Text>
              {item.due_date && <Text style={styles.dueText}>Due {item.due_date}</Text>}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  screenTitle: { fontSize: 22, fontWeight: '700', color: '#fff' },
  newBtn: { backgroundColor: '#2563EB', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  card: { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#fff', lineHeight: 18 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, flexShrink: 0 },
  statusText: { fontSize: 10, fontWeight: '600' },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  metaText: { fontSize: 11, color: '#475569' },
  dueText: { fontSize: 11, color: '#F59E0B' },
  empty: { padding: 40, alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  emptySubtitle: { fontSize: 13, color: '#64748B', textAlign: 'center' },
})
