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

  // Recent open snags
  const { data: recentSnags } = useQuery({
    queryKey: ['dashboard-recent-snags', orgId],
    queryFn: async () => {
      const { data } = await (client as any)
        .schema('field')
        .from('snags')
        .select('id, title, priority, status')
        .eq('organisation_id', orgId)
        .in('status', ['open', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(3)
      return data ?? []
    },
    enabled: !!orgId,
  })

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'

  const priorityColor = (p: string) => ({
    critical: '#F87171',
    high: '#FB923C',
    medium: '#FBBF24',
    low: '#64748B',
  }[p] ?? '#64748B')

  return (
    <ScrollView
      testID="dashboard-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3B82F6" />}
    >
      <Text style={styles.greeting}>Hey, {firstName} 👋</Text>

      {/* KPI row */}
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

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        {[
          { label: 'Log Snag', icon: '⚠️', route: '/snags/create', color: '#7f1d1d', testID: 'quick-action-log-snag' },
          { label: 'Site Diary', icon: '📓', route: '/diary', color: '#1e3a5f', testID: 'quick-action-diary' },
          { label: 'Upload COC', icon: '📄', route: '/(tabs)/compliance', color: '#14532d', testID: 'quick-action-upload-coc' },
          { label: 'Scan QR', icon: '📷', route: '/qr-scan', color: '#1e1b4b', testID: 'quick-action-scan-qr' },
          { label: 'Marketplace', icon: '🛒', route: '/marketplace', color: '#3b1f6b', testID: 'quick-action-marketplace' },
          { label: 'Compliance', icon: '✅', route: '/(tabs)/compliance', color: '#14532d', testID: 'quick-action-compliance' },
        ].map(({ label, icon, route, color, testID }) => (
          <TouchableOpacity
            key={label}
            testID={testID}
            style={[styles.actionCard, { backgroundColor: color + '44', borderColor: color + '88' }]}
            onPress={() => router.push(route as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{icon}</Text>
            <Text style={styles.actionLabel}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent snags */}
      {(recentSnags?.length ?? 0) > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Snags</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/snags' as any)}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          {recentSnags!.map((snag: any) => (
            <TouchableOpacity
              key={snag.id}
              style={styles.snagCard}
              onPress={() => router.push(`/snags/${snag.id}` as any)}
              activeOpacity={0.7}
            >
              <View style={[styles.priorityDot, { backgroundColor: priorityColor(snag.priority) }]} />
              <Text style={styles.snagTitle} numberOfLines={1}>{snag.title}</Text>
              <Text style={[styles.snagStatus, snag.status === 'in_progress' && { color: '#60A5FA' }]}>
                {snag.status === 'in_progress' ? 'In progress' : 'Open'}
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 20, paddingBottom: 40 },
  greeting: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 20 },
  kpiGrid: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  kpiCard: { flex: 1, backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  kpiDanger: { borderColor: '#7f1d1d' },
  kpiWarning: { borderColor: '#78350f' },
  kpiValue: { fontSize: 28, fontWeight: '700', color: '#fff' },
  kpiLabel: { fontSize: 11, color: '#64748B', marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#94A3B8', marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  seeAll: { fontSize: 13, color: '#3B82F6' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 },
  actionCard: {
    width: '30%',
    flexGrow: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionIcon: { fontSize: 26, marginBottom: 6 },
  actionLabel: { fontSize: 11, fontWeight: '600', color: '#CBD5E1', textAlign: 'center' },
  snagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  snagTitle: { flex: 1, fontSize: 14, color: '#E2E8F0', fontWeight: '500' },
  snagStatus: { fontSize: 12, color: '#64748B', fontWeight: '500' },
})
