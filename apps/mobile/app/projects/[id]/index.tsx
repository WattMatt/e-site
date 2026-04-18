import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { projectService, snagService, rfiService, formatDate, formatZAR } from '@esite/shared'
import { useSupabase } from '../../../src/providers/SupabaseProvider'
import { colors, fontSize, fontWeight, radius, spacing } from '../../../src/theme'

function KpiBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  )
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const client = useSupabase()

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectService.getById(client, id),
    enabled: !!id,
  })

  const { data: snagStats, refetch: refetchStats, isRefetching } = useQuery({
    queryKey: ['snag-stats', id],
    queryFn: () => snagService.getStats(client, id),
    enabled: !!id,
  })

  const { data: rfis } = useQuery({
    queryKey: ['rfis', id],
    queryFn: () => rfiService.list(client, id),
    enabled: !!id,
  })

  const openRfis = rfis?.filter(r => r.status === 'open').length ?? 0
  const members = (project as any)?.project_members ?? []

  if (loadingProject) {
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
  }
  if (!project) {
    return <View style={styles.center}><Text style={styles.emptyText}>Project not found</Text></View>
  }

  const openCount = (snagStats?.open ?? 0) + (snagStats?.in_progress ?? 0)
  const pendingCount = snagStats?.pending_sign_off ?? 0

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchStats} tintColor={colors.amber} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{project.name}</Text>
        {(project.city || project.province) && (
          <Text style={styles.subtitle}>{[project.city, project.province].filter(Boolean).join(', ')}</Text>
        )}

        <View style={styles.kpiRow}>
          <KpiBox label="Open Snags"        value={openCount}                       color={openCount > 0 ? colors.red : undefined} />
          <KpiBox label="Pending Sign-off"  value={pendingCount}                    color={pendingCount > 0 ? colors.amber : undefined} />
          <KpiBox label="Signed Off"        value={snagStats?.signed_off ?? 0}      color={colors.green} />
          <KpiBox label="Open RFIs"         value={openRfis}                        color={openRfis > 0 ? colors.orange : undefined} />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push({ pathname: '/snags/create', params: { projectId: id } } as any)}
          >
            <Text style={styles.actionText}>+ New Snag</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnGhost]}
            onPress={() => router.push({ pathname: '/rfis/create', params: { projectId: id } } as any)}
          >
            <Text style={styles.actionTextGhost}>+ New RFI</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnGhost, { marginTop: -10 }]}
          onPress={() => router.push({ pathname: '/diary/[projectId]', params: { projectId: id } } as any)}
        >
          <Text style={styles.actionTextGhost}>📓 Site Diary</Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.metaCard}>
            {project.client_name && <MetaRow label="Client" value={project.client_name} />}
            {(project as any).contract_value && <MetaRow label="Contract" value={formatZAR((project as any).contract_value)} />}
            {project.start_date && <MetaRow label="Start" value={formatDate(project.start_date)} />}
            {project.end_date && <MetaRow label="End" value={formatDate(project.end_date)} />}
          </View>
        </View>

        {members.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Team ({members.length})</Text>
            <View style={styles.teamList}>
              {members.map((m: any) => (
                <View key={m.id} style={styles.teamMember}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{m.profile?.full_name?.[0] ?? '?'}</Text>
                  </View>
                  <View>
                    <Text style={styles.memberName}>{m.profile?.full_name}</Text>
                    <Text style={styles.memberRole}>{m.role}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {rfis && rfis.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent RFIs</Text>
            <View style={styles.rfiList}>
              {rfis.slice(0, 5).map((rfi: any) => {
                const statusColor =
                  rfi.status === 'open' ? colors.red :
                  rfi.status === 'responded' ? colors.blue :
                  colors.green
                return (
                  <TouchableOpacity key={rfi.id} style={styles.rfiRow} onPress={() => router.push(`/rfis/${rfi.id}` as any)}>
                    <View style={styles.rfiLeft}>
                      <Text style={styles.rfiSubject} numberOfLines={1}>{rfi.subject}</Text>
                      <Text style={styles.rfiMeta}>{formatDate(rfi.created_at)}</Text>
                    </View>
                    <Text style={[styles.rfiStatus, { color: statusColor }]}>
                      {rfi.status}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMid, fontSize: fontSize.md },
  header: { paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.md },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  content: { padding: spacing.lg, gap: spacing.xl },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, lineHeight: 28 },
  subtitle: { fontSize: fontSize.body, color: colors.textMid, marginTop: 2 },
  kpiRow: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.sm + 2, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  kpiValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  kpiLabel: { fontSize: fontSize.micro, color: colors.textMid, marginTop: 2, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6 },
  actions: { flexDirection: 'row', gap: spacing.sm + 2 },
  actionBtn: { flex: 1, backgroundColor: colors.amber, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  actionBtnGhost: { backgroundColor: colors.transparent, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.base, fontWeight: fontWeight.bold, fontSize: fontSize.body },
  actionTextGhost: { color: colors.textMid, fontWeight: fontWeight.bold, fontSize: fontSize.body },
  section: { gap: spacing.sm + 2 },
  sectionTitle: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaCard: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderColor: colors.border },
  metaLabel: { fontSize: fontSize.small, color: colors.textMid },
  metaValue: { fontSize: fontSize.small, color: colors.text, fontWeight: fontWeight.medium },
  teamList: { gap: spacing.sm + 2 },
  teamMember: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.base, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },
  memberName: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  memberRole: { color: colors.textMid, fontSize: fontSize.caption, marginTop: 1, textTransform: 'capitalize' },
  rfiList: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  rfiRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderColor: colors.border },
  rfiLeft: { flex: 1 },
  rfiSubject: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  rfiMeta: { color: colors.textMid, fontSize: fontSize.caption, marginTop: 2 },
  rfiStatus: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
})
