import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useQuery } from '@tanstack/react-query'
import { snagService, formatDate } from '@esite/shared'
import { useProjects } from '../../src/hooks/useProjects'

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444',
  high: '#F97316',
  medium: '#EAB308',
  low: '#6B7280',
}

const STATUS_BG: Record<string, string> = {
  open: '#450a0a',
  in_progress: '#451a03',
  resolved: '#1e3a5f',
  pending_sign_off: '#3d2506',
  signed_off: '#14532d',
  closed: '#1e293b',
}

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

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" /></View>
  }

  return (
    <View testID="snags-list-screen" style={styles.container}>
      <FlatList
        data={snags ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3B82F6" />}
        contentContainerStyle={styles.list}
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
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/snags/${item.id}` as any)}
            activeOpacity={0.7}
          >
            <View style={styles.cardRow}>
              <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[item.priority] ?? '#6B7280' }]} />
              <View style={styles.cardFlex}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSub}>
                  {(item as any).project?.name} · {item.location ?? 'No location'}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_BG[item.status] ?? '#1e293b' }]}>
                <Text style={styles.statusText}>{item.status.replace(/_/g, ' ')}</Text>
              </View>
            </View>
            <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 10 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  screenTitle: { fontSize: 22, fontWeight: '700', color: '#fff' },
  newBtn: { backgroundColor: '#2563EB', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  card: { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  cardFlex: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },
  cardSub: { fontSize: 11, color: '#64748B', marginTop: 2 },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  statusText: { fontSize: 10, color: '#94A3B8', fontWeight: '500' },
  dateText: { fontSize: 11, color: '#475569', marginTop: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
})
