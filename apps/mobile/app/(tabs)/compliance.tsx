import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { complianceService } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

const COC_DOT: Record<string, string> = {
  approved:     colors.green,
  submitted:    colors.blue,
  under_review: colors.amber,
  missing:      colors.red,
  rejected:     colors.red,
}

function ScoreRing({ score }: { score: number }) {
  const color = score === 100 ? colors.green : score >= 50 ? colors.amber : colors.red
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
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
  }

  return (
    <View testID="compliance-screen" style={styles.container}>
      <FlatList
        data={sites ?? []}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.amber} />}
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
                  <StatPill label="Approved" count={approved} tone="green" />
                  <StatPill label="Pending"  count={pending}  tone="amber" />
                  <StatPill label="Missing"  count={missing}  tone="red" />
                </View>
              )}

              {subs.length > 0 && (
                <View style={styles.dotsRow}>
                  {subs.slice(0, 12).map((s: any) => (
                    <View
                      key={s.id}
                      style={[styles.dot, { backgroundColor: COC_DOT[s.coc_status] ?? colors.border }]}
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

const STAT_PILL_TONE = {
  green: { bg: colors.greenDim, fg: colors.green },
  amber: { bg: colors.amberDim, fg: colors.amber },
  red:   { bg: colors.redDim,   fg: colors.red },
} as const

function StatPill({ label, count, tone }: { label: string; count: number; tone: keyof typeof STAT_PILL_TONE }) {
  const t = STAT_PILL_TONE[tone]
  return (
    <View style={[styles.statPill, { backgroundColor: t.bg }]}>
      <Text style={[styles.statCount, { color: t.fg }]}>{count}</Text>
      <Text style={[styles.statLabel, { color: t.fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, gap: spacing.md },
  screenTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.sm },
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardInfo: { flex: 1, gap: 2 },
  siteName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  siteAddress: { fontSize: fontSize.small, color: colors.textMid },
  ring: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ringText: { fontSize: fontSize.small, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statPill: { flex: 1, borderRadius: radius.lg, paddingVertical: 6, alignItems: 'center' },
  statCount: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  statLabel: { fontSize: fontSize.tiny, fontWeight: fontWeight.semibold, opacity: 0.8 },
  dotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  moreText: { fontSize: fontSize.caption, color: colors.textMid },
  subCount: { fontSize: fontSize.caption, color: colors.textDim },
  empty: { padding: 40, alignItems: 'center', gap: spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  emptySubtitle: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center' },
})
