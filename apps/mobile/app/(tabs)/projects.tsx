import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useProjects } from '../../src/hooks/useProjects'
import { formatZAR } from '@esite/shared'

export default function ProjectsTab() {
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''
  const { data: projects, isLoading, refetch, isRefetching } = useProjects(orgId)
  const router = useRouter()

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3B82F6" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={projects ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3B82F6" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>📁</Text>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyDesc}>Projects created on the web will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/projects/${item.id}` as any)}
            activeOpacity={0.7}
          >
            <View style={styles.cardRow}>
              <View style={styles.cardFlex}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {item.city && <Text style={styles.cardSub}>{item.city}{item.province ? `, ${item.province}` : ''}</Text>}
              </View>
              <View style={[styles.statusBadge, STATUS_COLORS[item.status] ?? styles.statusDefault]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>
            {item.client_name && (
              <Text style={styles.clientText}>Client: {item.client_name}</Text>
            )}
            {item.contract_value && (
              <Text style={styles.valueText}>{formatZAR(item.contract_value)}</Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const STATUS_COLORS: Record<string, object> = {
  active: { backgroundColor: '#14532d' },
  planning: { backgroundColor: '#1e3a5f' },
  on_hold: { backgroundColor: '#451a03' },
  completed: { backgroundColor: '#1e293b' },
  cancelled: { backgroundColor: '#450a0a' },
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardFlex: { flex: 1, marginRight: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  cardSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusDefault: { backgroundColor: '#334155' },
  statusText: { fontSize: 11, color: '#94A3B8', fontWeight: '500' },
  clientText: { fontSize: 12, color: '#64748B', marginTop: 8 },
  valueText: { fontSize: 13, color: '#3B82F6', fontWeight: '600', marginTop: 4 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  emptyDesc: { fontSize: 13, color: '#64748B', textAlign: 'center' },
})
