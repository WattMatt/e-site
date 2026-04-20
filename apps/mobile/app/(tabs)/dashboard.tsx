import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useQuery } from '@tanstack/react-query'
import { projectService } from '@esite/shared'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing } from '../../src/theme'
import { SkeletonKpiCard } from '../../src/components/Skeleton'

const QUICK_ACTIONS = [
  { label: 'Log Snag',    icon: '⚠️', route: '/snags/create',       bg: colors.redDim,    border: colors.redMid,    testID: 'quick-action-log-snag' },
  { label: 'Site Diary',  icon: '📓', route: '/diary',               bg: colors.blueDim,   border: colors.blueMid,   testID: 'quick-action-diary' },
  { label: 'Upload COC',  icon: '📄', route: '/(tabs)/compliance',   bg: colors.greenDim,  border: colors.greenMid,  testID: 'quick-action-upload-coc' },
  { label: 'Scan QR',     icon: '📷', route: '/qr-scan',             bg: colors.elevated,  border: colors.borderMid, testID: 'quick-action-scan-qr' },
  { label: 'Marketplace', icon: '🛒', route: '/marketplace',         bg: colors.amberDim,  border: colors.amberMid,  testID: 'quick-action-marketplace' },
  { label: 'Compliance',  icon: '✅', route: '/(tabs)/compliance',   bg: colors.greenDim,  border: colors.greenMid,  testID: 'quick-action-compliance' },
] as const

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
  const openSnags = stats?.openSnags ?? 0
  const pendingCocs = stats?.pendingCocs ?? 0

  return (
    <ScrollView
      testID="dashboard-screen"
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.amber} />}
    >
      <Text style={styles.greeting}>Hey, {firstName} 👋</Text>

      <View style={styles.kpiGrid}>
        {isLoading && !stats ? (
          <>
            <SkeletonKpiCard />
            <SkeletonKpiCard />
            <SkeletonKpiCard />
          </>
        ) : (
          <>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{stats?.activeProjects ?? 0}</Text>
              <Text style={styles.kpiLabel}>Active Projects</Text>
            </View>
            <View style={[styles.kpiCard, openSnags > 0 && { borderColor: colors.redMid }]}>
              <Text style={[styles.kpiValue, openSnags > 0 && { color: colors.red }]}>
                {openSnags}
              </Text>
              <Text style={styles.kpiLabel}>Open Snags</Text>
            </View>
            <View style={[styles.kpiCard, pendingCocs > 0 && { borderColor: colors.amberMid }]}>
              <Text style={[styles.kpiValue, pendingCocs > 0 && { color: colors.amber }]}>
                {pendingCocs}
              </Text>
              <Text style={styles.kpiLabel}>Pending COCs</Text>
            </View>
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        {QUICK_ACTIONS.map(({ label, icon, route, bg, border, testID }) => (
          <TouchableOpacity
            key={label}
            testID={testID}
            style={[styles.actionCard, { backgroundColor: bg, borderColor: border }]}
            onPress={() => router.push(route as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{icon}</Text>
            <Text style={styles.actionLabel}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

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
              <Text style={[styles.snagStatus, snag.status === 'in_progress' && { color: colors.amber }]}>
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
  container: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxxl },
  greeting: { fontSize: fontSize.xl + 2, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.xl },
  kpiGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: 28 },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiValue: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  kpiLabel: { fontSize: fontSize.caption, color: colors.textMid, marginTop: spacing.xs },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.textMid, marginBottom: spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  seeAll: { fontSize: fontSize.body, color: colors.amber },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: 28 },
  actionCard: {
    width: '30%',
    flexGrow: 1,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionIcon: { fontSize: 26, marginBottom: 6 },
  actionLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center' },
  snagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  snagTitle: { flex: 1, fontSize: fontSize.bodyLg, color: colors.text, fontWeight: fontWeight.medium },
  snagStatus: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium },
})
