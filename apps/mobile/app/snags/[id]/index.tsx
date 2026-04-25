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
import { colors, fontSize, fontWeight, priorityColor, radius, spacing, statusBadge } from '../../../src/theme'

const STATUS_FLOW: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['resolved', 'pending_sign_off'],
  resolved: ['pending_sign_off'],
  pending_sign_off: ['signed_off'],
  signed_off: ['closed'],
  closed: [],
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

  const STATUS_LABELS: Record<string, string> = {
    open: 'Open', in_progress: 'In Progress', resolved: 'Resolved',
    pending_sign_off: 'Pending Sign-off', signed_off: 'Signed Off', closed: 'Closed',
  }

  const updateStatus = useMutation({
    mutationFn: (status: string) => snagService.update(client, id, { status } as any),
    onSuccess: async (updated) => {
      queryClient.invalidateQueries({ queryKey: ['snag', id] })
      queryClient.invalidateQueries({ queryKey: ['snags-org', orgId] })

      // Notify raised_by + assigned_to (best-effort)
      try {
        const { data: { session } } = await client.auth.getSession()
        if (!session) return
        const currentSnag = snag as any
        const notifyIds = [currentSnag?.raised_by, currentSnag?.assigned_to]
          .filter((uid): uid is string => Boolean(uid) && uid !== profile?.id)
        const uniqueIds = [...new Set(notifyIds)]
        if (uniqueIds.length === 0) return

        const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://esite-lilac.vercel.app'
        await fetch(`${webUrl}/api/notifications/dispatch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            userIds: uniqueIds,
            title: 'Snag status updated',
            body: `"${currentSnag?.title}" is now ${STATUS_LABELS[(updated as any).status] ?? (updated as any).status}`,
            type: 'snag_status_changed',
            entityType: 'snag',
            entityId: id,
            route: `/snags/${id}`,
          }),
        }).catch(() => {/* non-blocking */})
      } catch {
        // Never block the status update on notification failure
      }
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
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
  }
  if (!snag) {
    return <View style={styles.center}><Text style={styles.emptyText}>Snag not found</Text></View>
  }

  const raisedBy = (snag as any).raised_by_profile
  const assignedTo = (snag as any).assigned_to_profile
  const project = (snag as any).project
  const nextStatuses = STATUS_FLOW[snag.status] ?? []
  const photos = photoUrls ?? []
  const currentBadge = statusBadge(snag.status)

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
            <View style={[styles.priorityDot, { backgroundColor: priorityColor(snag.priority) }]} />
            <Text style={styles.title}>{snag.title}</Text>
          </View>

          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: currentBadge.bg, borderColor: currentBadge.border }]}>
              <Text style={[styles.statusText, { color: currentBadge.fg }]}>{snag.status.replace(/_/g, ' ')}</Text>
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
                        <ActivityIndicator color={colors.textDim} size="small" />
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
                {nextStatuses.map(s => {
                  const b = statusBadge(s)
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.actionBtn, { borderColor: b.fg }]}
                      onPress={() => confirmStatusChange(s)}
                      disabled={updateStatus.isPending}
                    >
                      {updateStatus.isPending ? (
                        <ActivityIndicator color={b.fg} size="small" />
                      ) : (
                        <Text style={[styles.actionText, { color: b.fg }]}>{s.replace(/_/g, ' ')}</Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
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
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMid, fontSize: fontSize.md },
  header: { paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.md },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  content: { padding: spacing.lg, gap: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  priorityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  title: { fontSize: fontSize.lg + 2, fontWeight: fontWeight.bold, color: colors.text, flex: 1, lineHeight: 26 },
  badgeRow: { flexDirection: 'row', gap: spacing.sm },
  statusBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  statusText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  catBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.borderMid },
  catText: { fontSize: fontSize.small, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaCard: { backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderColor: colors.border },
  metaLabel: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium },
  metaValue: { fontSize: fontSize.small, color: colors.text, fontWeight: fontWeight.medium, maxWidth: '60%', textAlign: 'right' },
  descCard: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg - 2, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  sectionLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm },
  descText: { fontSize: fontSize.bodyLg, color: colors.text, lineHeight: 20 },
  section: { gap: 2 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  photoThumb: { width: 96, height: 96, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', gap: spacing.sm + 2, flexWrap: 'wrap', marginTop: spacing.sm },
  actionBtn: { flex: 1, minWidth: 120, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center' },
  actionText: { fontSize: fontSize.body, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  lightboxBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '100%', height: '80%' },
  lightboxClose: { position: 'absolute', top: 52, right: spacing.lg, backgroundColor: colors.panel, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lightboxCloseText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  floorPlanBtn: { backgroundColor: colors.amberDim, borderWidth: 1, borderColor: colors.amberMid, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  floorPlanBtnText: { color: colors.amber, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  unpinnedText: { fontSize: fontSize.body, color: colors.textDim, marginTop: spacing.xs },
})
