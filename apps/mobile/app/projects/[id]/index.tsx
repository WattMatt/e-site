import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { projectService, snagService, rfiService, formatDate, formatZAR } from '@esite/shared'
import { useSupabase } from '../../../src/providers/SupabaseProvider'

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F97316', resolved: '#3B82F6',
  pending_sign_off: '#EAB308', signed_off: '#10B981', closed: '#6B7280',
}
const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}

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
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
  }
  if (!project) {
    return <View style={styles.center}><Text style={styles.emptyText}>Project not found</Text></View>
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchStats} tintColor="#3B82F6" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Title */}
        <Text style={styles.title}>{project.name}</Text>
        {(project.city || project.province) && (
          <Text style={styles.subtitle}>{[project.city, project.province].filter(Boolean).join(', ')}</Text>
        )}

        {/* KPI row */}
        <View style={styles.kpiRow}>
          <KpiBox label="Open Snags" value={(snagStats?.open ?? 0) + (snagStats?.in_progress ?? 0)} color={(snagStats?.open ?? 0) > 0 ? '#EF4444' : undefined} />
          <KpiBox label="Pending Sign-off" value={snagStats?.pending_sign_off ?? 0} color={(snagStats?.pending_sign_off ?? 0) > 0 ? '#EAB308' : undefined} />
          <KpiBox label="Signed Off" value={snagStats?.signed_off ?? 0} color="#10B981" />
          <KpiBox label="Open RFIs" value={openRfis} color={openRfis > 0 ? '#F97316' : undefined} />
        </View>

        {/* Quick actions */}
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

        {/* Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.metaCard}>
            {project.client_name && <MetaRow label="Client" value={project.client_name} />}
            {(project as any).contract_value && <MetaRow label="Contract" value={formatZAR((project as any).contract_value)} />}
            {project.start_date && <MetaRow label="Start" value={formatDate(project.start_date)} />}
            {project.end_date && <MetaRow label="End" value={formatDate(project.end_date)} />}
          </View>
        </View>

        {/* Team */}
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

        {/* Recent RFIs */}
        {rfis && rfis.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent RFIs</Text>
            <View style={styles.rfiList}>
              {rfis.slice(0, 5).map((rfi: any) => (
                <TouchableOpacity key={rfi.id} style={styles.rfiRow} onPress={() => router.push(`/rfis/${rfi.id}` as any)}>
                  <View style={styles.rfiLeft}>
                    <Text style={styles.rfiSubject} numberOfLines={1}>{rfi.subject}</Text>
                    <Text style={styles.rfiMeta}>{formatDate(rfi.created_at)}</Text>
                  </View>
                  <Text style={[styles.rfiStatus, { color: rfi.status === 'open' ? '#EF4444' : rfi.status === 'responded' ? '#3B82F6' : '#10B981' }]}>
                    {rfi.status}
                  </Text>
                </TouchableOpacity>
              ))}
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
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#64748B', fontSize: 16 },
  header: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12 },
  backBtn: { padding: 4 },
  backText: { color: '#94A3B8', fontSize: 14 },
  content: { padding: 16, gap: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', lineHeight: 28 },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 2 },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: '#1E293B', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  kpiValue: { fontSize: 22, fontWeight: '700', color: '#fff' },
  kpiLabel: { fontSize: 9, color: '#64748B', marginTop: 2, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  actionBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155' },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  actionTextGhost: { color: '#94A3B8', fontWeight: '700', fontSize: 13 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaCard: { backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: '#334155' },
  metaLabel: { fontSize: 12, color: '#64748B' },
  metaValue: { fontSize: 12, color: '#CBD5E1', fontWeight: '500' },
  teamList: { gap: 10 },
  teamMember: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1E293B', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#334155' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  memberName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  memberRole: { color: '#64748B', fontSize: 11, marginTop: 1, textTransform: 'capitalize' },
  rfiList: { backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  rfiRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: '#334155' },
  rfiLeft: { flex: 1 },
  rfiSubject: { color: '#fff', fontSize: 13, fontWeight: '500' },
  rfiMeta: { color: '#64748B', fontSize: 11, marginTop: 2 },
  rfiStatus: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
})
