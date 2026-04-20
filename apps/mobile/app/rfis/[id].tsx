import { useState } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rfiService, formatRelative } from '@esite/shared'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing } from '../../src/theme'
import { AttachmentStaging } from '../../src/components/attachments/AttachmentStaging'
import { AttachmentGallery } from '../../src/components/attachments/AttachmentGallery'
import { FloorPlanAttachModal } from '../../src/components/attachments/FloorPlanAttachModal'
import { commitStagedAttachments, fetchAttachments } from '../../src/components/attachments/commit'
import type { StagedAttachment } from '../../src/components/attachments/types'

const RFI_STATUS: Record<string, { bg: string; fg: string; border: string }> = {
  draft:     { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
  open:      { bg: colors.redDim,   fg: colors.red,     border: colors.redMid },
  responded: { bg: colors.blueDim,  fg: colors.blue,    border: colors.blueMid },
  closed:    { bg: colors.greenDim, fg: colors.green,   border: colors.greenMid },
}

export default function RfiDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [responseBody, setResponseBody] = useState('')
  const [responseAttachments, setResponseAttachments] = useState<StagedAttachment[]>([])
  const [floorPlanOpen, setFloorPlanOpen] = useState(false)

  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const { data: rfi, isLoading } = useQuery({
    queryKey: ['rfi', id],
    queryFn: () => rfiService.getById(client, id),
    enabled: !!id,
  })

  const { data: rfiAttachments = [] } = useQuery({
    queryKey: ['rfi-attachments', id],
    queryFn: () => fetchAttachments(client, 'rfi', id),
    enabled: !!id,
  })

  const responses = (rfi?.rfi_responses as any[]) ?? []

  const { data: responseAttachmentsMap = {} } = useQuery({
    queryKey: ['rfi-response-attachments', id, responses.map((r: any) => r.id).join(',')],
    queryFn: async () => {
      const pairs = await Promise.all(
        responses.map(async (r: any) => [r.id, await fetchAttachments(client, 'rfi_response', r.id)] as const),
      )
      return Object.fromEntries(pairs)
    },
    enabled: !!id && responses.length > 0,
  })

  const projectId = rfi?.project_id as string | undefined

  const respondMutation = useMutation({
    mutationFn: async () => {
      const response = await rfiService.respond(
        client, { rfiId: id, body: responseBody.trim() }, profile!.id,
      )

      if (responseAttachments.length > 0 && projectId && orgId) {
        try {
          await commitStagedAttachments({
            client,
            staged: responseAttachments,
            orgId,
            projectId,
            entityType: 'rfi_response',
            entityId: response.id,
            rfiId: id,
            userId: profile!.id,
          })
        } catch (attErr: any) {
          console.warn('[rfi-response] attachment commit failed:', attErr?.message)
        }
      }
      return response
    },
    onSuccess: () => {
      setResponseBody('')
      setResponseAttachments([])
      queryClient.invalidateQueries({ queryKey: ['rfi', id] })
      queryClient.invalidateQueries({ queryKey: ['rfi-attachments', id] })
      queryClient.invalidateQueries({ queryKey: ['rfi-response-attachments', id] })
      queryClient.invalidateQueries({ queryKey: ['rfis-org'] })
    },
    onError: (e: any) => Alert.alert('Error', e.message ?? 'Failed to submit response'),
  })

  const closeMutation = useMutation({
    mutationFn: () => rfiService.close(client, id, profile!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfi', id] })
      queryClient.invalidateQueries({ queryKey: ['rfis-org'] })
    },
    onError: (e: any) => Alert.alert('Error', e.message ?? 'Failed to close RFI'),
  })

  function handleClose() {
    Alert.alert(
      'Close RFI',
      'Mark this RFI as closed? No further responses can be added.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close RFI', style: 'destructive', onPress: () => closeMutation.mutate() },
      ],
    )
  }

  function handleRespond() {
    if (!responseBody.trim()) {
      Alert.alert('Required', 'Please enter a response.')
      return
    }
    respondMutation.mutate()
  }

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
  }

  if (!rfi) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>RFI not found</Text>
      </View>
    )
  }

  const isClosed = rfi.status === 'closed'
  const canRespond = !isClosed
  const canClose = rfi.status === 'responded'
  const status = RFI_STATUS[rfi.status] ?? RFI_STATUS.draft
  const canEdit = !!profile

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>RFI Detail</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <View style={[styles.priorityDot, { backgroundColor: priorityColor(rfi.priority) }]} />
          <Text style={styles.subject}>{rfi.subject}</Text>
        </View>

        <View style={styles.badgeRow}>
          <View style={[styles.statusBadge, { backgroundColor: status.bg, borderColor: status.border }]}>
            <Text style={[styles.statusText, { color: status.fg }]}>{rfi.status}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: colors.elevated, borderColor: colors.borderMid }]}>
            <Text style={[styles.statusText, { color: colors.textMid }]}>{rfi.priority}</Text>
          </View>
          {rfi.category ? (
            <View style={[styles.statusBadge, { backgroundColor: colors.elevated, borderColor: colors.borderMid }]}>
              <Text style={[styles.statusText, { color: colors.textMid }]}>{rfi.category.replace(/-/g, ' ')}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaCard}>
          <MetaRow label="Raised by" value={(rfi.raised_by_profile as any)?.full_name ?? '—'} />
          <MetaRow label="Assigned to" value={(rfi.assigned_to_profile as any)?.full_name ?? 'Unassigned'} />
          <MetaRow label="Raised" value={formatRelative(rfi.created_at)} />
          {rfi.due_date ? <MetaRow label="Due date" value={rfi.due_date} highlight /> : null}
          {rfi.closed_at ? <MetaRow label="Closed" value={formatRelative(rfi.closed_at)} /> : null}
        </View>

        {rfi.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Description</Text>
            <Text style={styles.descriptionText}>{rfi.description}</Text>
          </View>
        ) : null}

        {rfiAttachments.length > 0 && projectId && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Attachments</Text>
            <AttachmentGallery
              attachments={rfiAttachments}
              canEdit={canEdit}
              projectId={projectId}
              client={client}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ['rfi-attachments', id] })}
            />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Responses ({responses.length})</Text>
          {responses.length === 0 ? (
            <Text style={styles.emptyResponses}>No responses yet.</Text>
          ) : (
            responses.map((r: any) => {
              const atts = (responseAttachmentsMap as any)[r.id] ?? []
              return (
                <View key={r.id} style={styles.responseCard}>
                  <View style={styles.responseHeader}>
                    <Text style={styles.responderName}>{r.responder?.full_name ?? 'Unknown'}</Text>
                    <Text style={styles.responseDate}>{formatRelative(r.created_at)}</Text>
                  </View>
                  <Text style={styles.responseBody}>{r.body}</Text>
                  {atts.length > 0 && projectId && (
                    <AttachmentGallery
                      attachments={atts}
                      canEdit={canEdit}
                      projectId={projectId}
                      client={client}
                      onChanged={() => queryClient.invalidateQueries({ queryKey: ['rfi-response-attachments', id] })}
                    />
                  )}
                </View>
              )
            })
          )}
        </View>

        {canRespond ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Add Response</Text>
            <TextInput
              style={styles.responseInput}
              value={responseBody}
              onChangeText={setResponseBody}
              placeholder="Type your response…"
              placeholderTextColor={colors.textDim}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {projectId && (
              <AttachmentStaging
                projectId={projectId}
                value={responseAttachments}
                onChange={setResponseAttachments}
                allowFloorPlan
                onRequestFloorPlan={() => setFloorPlanOpen(true)}
              />
            )}
            <TouchableOpacity
              style={[styles.submitBtn, respondMutation.isPending && styles.btnDisabled]}
              onPress={handleRespond}
              disabled={respondMutation.isPending}
            >
              {respondMutation.isPending
                ? <ActivityIndicator color={colors.base} size="small" />
                : <Text style={styles.submitText}>Submit Response</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {canClose ? (
          <TouchableOpacity
            style={[styles.closeBtn, closeMutation.isPending && styles.btnDisabled]}
            onPress={handleClose}
            disabled={closeMutation.isPending}
          >
            {closeMutation.isPending
              ? <ActivityIndicator color={colors.green} size="small" />
              : <Text style={styles.closeBtnText}>Close RFI</Text>}
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>

      {projectId && (
        <FloorPlanAttachModal
          visible={floorPlanOpen}
          projectId={projectId}
          client={client}
          onClose={() => setFloorPlanOpen(false)}
          onStage={staged => {
            setResponseAttachments(prev => [...prev, staged])
            setFloorPlanOpen(false)
          }}
        />
      )}
    </KeyboardAvoidingView>
  )
}

function MetaRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, highlight && styles.metaHighlight]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base },
  errorText: { color: colors.red, fontSize: fontSize.bodyLg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: spacing.sm },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2 },
  priorityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, flexShrink: 0 },
  subject: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, lineHeight: 24 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.md, borderWidth: 1 },
  statusText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaCard: {
    backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg - 2, paddingVertical: 11,
    borderBottomWidth: 1, borderColor: colors.border,
  },
  metaLabel: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium },
  metaValue: { fontSize: fontSize.body, color: colors.text, fontWeight: fontWeight.medium, maxWidth: '60%', textAlign: 'right' },
  metaHighlight: { color: colors.amber },
  section: { gap: spacing.sm + 2 },
  sectionLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  descriptionText: { fontSize: fontSize.bodyLg, color: colors.text, lineHeight: 22 },
  emptyResponses: { fontSize: fontSize.body, color: colors.textDim, fontStyle: 'italic' },
  responseCard: {
    backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  responseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  responderName: { fontSize: fontSize.body, fontWeight: fontWeight.bold, color: colors.text },
  responseDate: { fontSize: fontSize.caption, color: colors.textDim },
  responseBody: { fontSize: fontSize.bodyLg, color: colors.text, lineHeight: 20 },
  responseInput: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.md,
    fontSize: fontSize.bodyLg, color: colors.text, minHeight: 100,
  },
  submitBtn: { backgroundColor: colors.amber, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  submitText: { color: colors.base, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  closeBtn: {
    borderRadius: radius.md, paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: colors.green, backgroundColor: colors.greenDim,
  },
  closeBtnText: { color: colors.green, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
})
