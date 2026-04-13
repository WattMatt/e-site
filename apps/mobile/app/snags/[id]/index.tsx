import { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { snagService, storageService, floorPlanService, formatDate } from '@esite/shared'
import { useSupabase } from '../../../src/providers/SupabaseProvider'
import { useAuth } from '../../../src/providers/AuthProvider'

const STATUS_FLOW: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['resolved', 'pending_sign_off'],
  resolved: ['pending_sign_off'],
  pending_sign_off: ['signed_off'],
  signed_off: ['closed'],
  closed: [],
}

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F97316', resolved: '#3B82F6',
  pending_sign_off: '#EAB308', signed_off: '#10B981', closed: '#6B7280',
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}

export default function SnagDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data: snag, isLoading } = useQuery({
    queryKey: ['snag', id],
    queryFn: () => snagService.getById(client, id),
    enabled: !!id,
  })

  // Generate signed URLs for photos
  const { data: photoUrls } = useQuery({
    queryKey: ['snag-photos', id],
    queryFn: async () => {
      const photos = (snag as any)?.snag_photos ?? []
      const urls = await Promise.all(
        photos.map(async (p: any) => {
          const url = await storageService.signedUrl(client, 'snag-photos', p.file_path, 3600)
          return { ...p, url }
        })
      )
      return urls
    },
    enabled: !!snag,
  })

  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const updateStatus = useMutation({
    mutationFn: (status: string) => snagService.update(client, id, { status } as any),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['snag', id] })
      queryClient.invalidateQueries({ queryKey: ['snags-org', orgId] })
    },
  })

  function confirmStatusChange(status: string) {
    const label = status.replace(/_/g, ' ')
    Alert.alert('Update Status', `Move snag to "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => updateStatus.mutate(status) },
    ])
  }

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
  }
  if (!snag) {
    return <View style={styles.center}><Text style={styles.emptyText}>Snag not found</Text></View>
  }

  const raisedBy = (snag as any).raised_by_profile
  const assignedTo = (snag as any).assigned_to_profile
  const project = (snag as any).project
  const nextStatuses = STATUS_FLOW[snag.status] ?? []
  const photos = photoUrls ?? []

  return (
    <>
      <ScrollView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {/* Title + badges */}
          <View style={styles.titleRow}>
            <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[snag.priority] ?? '#6B7280' }]} />
            <Text style={styles.title}>{snag.title}</Text>
          </View>

          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[snag.status] + '22', borderColor: STATUS_COLORS[snag.status] }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[snag.status] }]}>{snag.status.replace(/_/g, ' ')}</Text>
            </View>
            {snag.category && (
              <View style={styles.catBadge}>
                <Text style={styles.catText}>{snag.category}</Text>
              </View>
            )}
          </View>

          {/* Meta */}
          <View style={styles.metaCard}>
            {project && <MetaRow label="Project" value={project.name} />}
            {snag.location && <MetaRow label="Location" value={snag.location} />}
            {raisedBy && <MetaRow label="Raised by" value={raisedBy.full_name} />}
            {assignedTo && <MetaRow label="Assigned to" value={assignedTo.full_name} />}
            <MetaRow label="Created" value={formatDate(snag.created_at)} />
            {snag.resolved_at && <MetaRow label="Resolved" value={formatDate(snag.resolved_at)} />}
          </View>

          {/* Description */}
          {snag.description ? (
            <View style={styles.descCard}>
              <Text style={styles.sectionLabel}>Description</Text>
              <Text style={styles.descText}>{snag.description}</Text>
            </View>
          ) : null}

          {/* Photos */}
          {photos.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Photos ({photos.length})</Text>
              <View style={styles.photoGrid}>
                {photos.map((p: any) => (
                  <TouchableOpacity key={p.id} onPress={() => setLightbox(p.url)} style={styles.photoThumb}>
                    {p.url ? (
                      <Image source={{ uri: p.url }} style={styles.photo} resizeMode="cover" />
                    ) : (
                      <View style={[styles.photo, styles.photoPlaceholder]}>
                        <ActivityIndicator color="#475569" size="small" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Floor plan pin */}
          {snag.floor_plan_pin ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Floor Plan</Text>
              <TouchableOpacity
                style={styles.floorPlanBtn}
                onPress={() => router.push({
                  pathname: `/floor-plans/${(snag.floor_plan_pin as any).floorPlanId}`,
                } as any)}
              >
                <Text style={styles.floorPlanBtnText}>📌  View on Floor Plan</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Floor Plan</Text>
              <Text style={styles.unpinnedText}>Not pinned on any floor plan</Text>
            </View>
          )}

          {/* Status actions */}
          {nextStatuses.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Update Status</Text>
              <View style={styles.actionRow}>
                {nextStatuses.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.actionBtn, { borderColor: STATUS_COLORS[s] }]}
                    onPress={() => confirmStatusChange(s)}
                    disabled={updateStatus.isPending}
                  >
                    {updateStatus.isPending ? (
                      <ActivityIndicator color={STATUS_COLORS[s]} size="small" />
                    ) : (
                      <Text style={[styles.actionText, { color: STATUS_COLORS[s] }]}>{s.replace(/_/g, ' ')}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Lightbox */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <TouchableOpacity style={styles.lightboxBg} activeOpacity={1} onPress={() => setLightbox(null)}>
          {lightbox && (
            <Image source={{ uri: lightbox }} style={styles.lightboxImg} resizeMode="contain" />
          )}
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightbox(null)}>
            <Text style={styles.lightboxCloseText}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
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
  content: { padding: 16, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  title: { fontSize: 20, fontWeight: '700', color: '#fff', flex: 1, lineHeight: 26 },
  badgeRow: { flexDirection: 'row', gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  statusText: { fontSize: 12, fontWeight: '600' },
  catBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155' },
  catText: { fontSize: 12, color: '#64748B' },
  metaCard: { backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#334155' },
  metaLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  metaValue: { fontSize: 12, color: '#CBD5E1', fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  descCard: { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155', gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  descText: { fontSize: 14, color: '#CBD5E1', lineHeight: 20 },
  section: { gap: 2 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  photoThumb: { width: 96, height: 96, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#334155' },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 8 },
  actionBtn: { flex: 1, minWidth: 120, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
  actionText: { fontSize: 13, fontWeight: '700' },
  lightboxBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '100%', height: '80%' },
  lightboxClose: { position: 'absolute', top: 52, right: 16, backgroundColor: '#1E293B', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lightboxCloseText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  floorPlanBtn: { backgroundColor: '#1E3A5F', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  floorPlanBtnText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
  unpinnedText: { fontSize: 13, color: '#475569', marginTop: 4 },
})
