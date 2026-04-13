import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useQuery } from '@tanstack/react-query'
import { projectService } from '@esite/shared'

export default function DashboardTab() {
  const { profile } = useAuth()
  const client = useSupabase()
  const router = useRouter()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const { data: stats, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['dashboard-stats', orgId],
    queryFn: () => projectService.getStats(client, orgId),
    enabled: !!orgId,
  })

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3B82F6" />}
    >
      <Text style={styles.greeting}>Hey, {firstName} 👋</Text>

      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{isLoading ? '…' : stats?.activeProjects ?? 0}</Text>
          <Text style={styles.kpiLabel}>Active Projects</Text>
        </View>
        <View style={[styles.kpiCard, (stats?.openSnags ?? 0) > 0 && styles.kpiDanger]}>
          <Text style={[styles.kpiValue, (stats?.openSnags ?? 0) > 0 && { color: '#F87171' }]}>
            {isLoading ? '…' : stats?.openSnags ?? 0}
          </Text>
          <Text style={styles.kpiLabel}>Open Snags</Text>
        </View>
        <View style={[styles.kpiCard, (stats?.pendingCocs ?? 0) > 0 && styles.kpiWarning]}>
          <Text style={[styles.kpiValue, (stats?.pendingCocs ?? 0) > 0 && { color: '#FBBF24' }]}>
            {isLoading ? '…' : stats?.pendingCocs ?? 0}
          </Text>
          <Text style={styles.kpiLabel}>Pending COCs</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actions}>
        {[
          { label: 'Raise Snag', icon: '⚠️', route: '/snags/create' },
          { label: 'View Projects', icon: '📁', route: '/(tabs)/projects' },
          { label: 'Compliance', icon: '✅', route: '/(tabs)/compliance' },
        ].map(({ label, icon, route }) => (
          <TouchableOpacity
            key={label}
            style={styles.actionCard}
            onPress={() => router.push(route as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{icon}</Text>
            <Text style={styles.actionLabel}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 20 },
  greeting: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 20 },
  kpiGrid: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  kpiCard: { flex: 1, backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  kpiDanger: { borderColor: '#7f1d1d' },
  kpiWarning: { borderColor: '#78350f' },
  kpiValue: { fontSize: 28, fontWeight: '700', color: '#fff' },
  kpiLabel: { fontSize: 11, color: '#64748B', marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#94A3B8', marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  actionCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionIcon: { fontSize: 28, marginBottom: 8 },
  actionLabel: { fontSize: 12, fontWeight: '500', color: '#94A3B8', textAlign: 'center' },
})
