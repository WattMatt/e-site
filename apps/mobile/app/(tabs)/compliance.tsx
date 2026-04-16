import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { complianceService } from '@esite/shared'

const STATUS_COLORS: Record<string, string> = {
  approved: '#10B981',
  submitted: '#3B82F6',
  under_review: '#F59E0B',
  missing: '#EF4444',
  rejected: '#EF4444',
}

function ScoreRing({ score }: { score: number }) {
  const color = score === 100 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444'
  return (
    <View style={[styles.ring, { borderColor: color }]}>
      <Text style={[styles.ringText, { color }]}>{score}%</Text>
    </View>
  )
}

export default function ComplianceTab() {
  const { profile } = useAuth()
  const client = useSupabase()
  const router = useRouter()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const { data: sites, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['compliance-sites', orgId],
    queryFn: () => complianceService.listSites(client, orgId),
    enabled: !!orgId,
  })

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
  }

  return (
    <View testID="compliance-screen" style={styles.container}>
      <FlatList
        data={sites ?? []}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#3B82F6" />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.screenTitle}>Compliance</Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No sites yet</Text>
            <Text style={styles.emptySubtitle}>Create a site from the web dashboard to track COC compliance.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const subs = (item as any).subsections ?? []
          const total = subs.length
          const approved = subs.filter((s: any) => s.coc_status === 'approved').length
          const pending = subs.filter((s: any) => ['submitted', 'under_review'].includes(s.coc_status)).length
          const missing = total - approved - pending
          const score = total === 0 ? 0 : Math.round((approved / total) * 100)

          return (
            <View testID="compliance-site-card" style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardInfo}>
                  <Text style={styles.siteName}>{item.name}</Text>
                  <Text style={styles.siteAddress}>{item.address}</Text>
                  {(item as any).city && <Text style={styles.siteAddress}>{(item as any).city}</Text>}
                </View>
                <ScoreRing score={score} />
              </View>

              {total > 0 && (
                <View style={styles.statsRow}>
                  <StatPill label="Approved" count={approved} color="#10B981" />
                  <StatPill label="Pending" count={pending} color="#F59E0B" />
                  <StatPill label="Missing" count={missing} color="#EF4444" />
                </View>
              )}

              {/* Subsection status dots */}
              {subs.length > 0 && (
                <View style={styles.dotsRow}>
                  {subs.slice(0, 12).map((s: any) => (
                    <View
                      key={s.id}
                      style={[styles.dot, { backgroundColor: STATUS_COLORS[s.coc_status] ?? '#334155' }]}
                    />
                  ))}
                  {subs.length > 12 && (
                    <Text style={styles.moreText}>+{subs.length - 12}</Text>
                  )}
                </View>
              )}

              <Text style={styles.subCount}>{total} subsection{total !== 1 ? 's' : ''}</Text>
            </View>
          )
        }}
      />
    </View>
  )
}

function StatPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={[styles.statPill, { backgroundColor: color + '22' }]}>
      <Text style={[styles.statCount, { color }]}>{count}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 },
  screenTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  card: { backgroundColor: '#1E293B', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#334155', gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardInfo: { flex: 1, gap: 2 },
  siteName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  siteAddress: { fontSize: 12, color: '#64748B' },
  ring: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ringText: { fontSize: 12, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 8 },
  statPill: { flex: 1, borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  statCount: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10, fontWeight: '600', opacity: 0.8 },
  dotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  moreText: { fontSize: 11, color: '#64748B' },
  subCount: { fontSize: 11, color: '#475569' },
  empty: { padding: 40, alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  emptySubtitle: { fontSize: 13, color: '#64748B', textAlign: 'center' },
})
