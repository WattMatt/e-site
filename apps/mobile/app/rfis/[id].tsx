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

const STATUS_COLORS: Record<string, string> = {
  draft: '#475569', open: '#EF4444', responded: '#3B82F6', closed: '#10B981',
}
const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}

export default function RfiDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [responseBody, setResponseBody] = useState('')

  const { data: rfi, isLoading } = useQuery({
    queryKey: ['rfi', id],
    queryFn: () => rfiService.getById(client, id),
    enabled: !!id,
  })

  const respondMutation = useMutation({
    mutationFn: () =>
      rfiService.respond(client, { rfiId: id, body: responseBody.trim() }, profile!.id),
    onSuccess: () => {
      setResponseBody('')
      queryClient.invalidateQueries({ queryKey: ['rfi', id] })
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
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
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

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
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
        {/* Subject + badges */}
        <View style={styles.titleRow}>
          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[rfi.priority] ?? '#6B7280' }]} />
          <Text style={styles.subject}>{rfi.subject}</Text>
        </View>

        <View style={styles.badgeRow}>
          <View style={[styles.statusBadge, {
            backgroundColor: STATUS_COLORS[rfi.status] + '22',
            borderColor: STATUS_COLORS[rfi.status],
          }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[rfi.status] }]}>{rfi.status}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: '#33415522', borderColor: '#334155' }]}>
            <Text style={[styles.statusText, { color: '#94A3B8' }]}>{rfi.priority}</Text>
          </View>
          {rfi.category ? (
            <View style={[styles.statusBadge, { backgroundColor: '#33415522', borderColor: '#334155' }]}>
              <Text style={[styles.statusText, { color: '#94A3B8' }]}>{rfi.category.replace(/-/g, ' ')}</Text>
            </View>
          ) : null}
        </View>

        {/* Metadata */}
        <View style={styles.metaCard}>
          <MetaRow label="Raised by" value={(rfi.raised_by_profile as any)?.full_name ?? '—'} />
          <MetaRow label="Assigned to" value={(rfi.assigned_to_profile as any)?.full_name ?? 'Unassigned'} />
          <MetaRow label="Raised" value={formatRelative(rfi.created_at)} />
          {rfi.due_date ? <MetaRow label="Due date" value={rfi.due_date} highlight /> : null}
          {rfi.closed_at ? <MetaRow label="Closed" value={formatRelative(rfi.closed_at)} /> : null}
        </View>

        {/* Description */}
        {rfi.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Description</Text>
            <Text style={styles.descriptionText}>{rfi.description}</Text>
          </View>
        ) : null}

        {/* Responses */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Responses ({(rfi.rfi_responses as any[])?.length ?? 0})
          </Text>
          {(rfi.rfi_responses as any[])?.length === 0 ? (
            <Text style={styles.emptyResponses}>No responses yet.</Text>
          ) : (
            (rfi.rfi_responses as any[]).map((r: any) => (
              <View key={r.id} style={styles.responseCard}>
                <View style={styles.responseHeader}>
                  <Text style={styles.responderName}>{r.responder?.full_name ?? 'Unknown'}</Text>
                  <Text style={styles.responseDate}>{formatRelative(r.created_at)}</Text>
                </View>
                <Text style={styles.responseBody}>{r.body}</Text>
              </View>
            ))
          )}
        </View>

        {/* Response form */}
        {canRespond ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Add Response</Text>
            <TextInput
              style={styles.responseInput}
              value={responseBody}
              onChangeText={setResponseBody}
              placeholder="Type your response…"
              placeholderTextColor="#475569"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.submitBtn, respondMutation.isPending && styles.btnDisabled]}
              onPress={handleRespond}
              disabled={respondMutation.isPending}
            >
              {respondMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitText}>Submit Response</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Close button */}
        {canClose ? (
          <TouchableOpacity
            style={[styles.closeBtn, closeMutation.isPending && styles.btnDisabled]}
            onPress={handleClose}
            disabled={closeMutation.isPending}
          >
            {closeMutation.isPending
              ? <ActivityIndicator color="#10B981" size="small" />
              : <Text style={styles.closeBtnText}>Close RFI</Text>}
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A' },
  errorText: { color: '#EF4444', fontSize: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16,
    borderBottomWidth: 1, borderColor: '#1E293B',
  },
  backBtn: { padding: 4 },
  backText: { color: '#94A3B8', fontSize: 14 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, flexShrink: 0 },
  subject: { flex: 1, fontSize: 18, fontWeight: '700', color: '#fff', lineHeight: 24 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: '600' },
  metaCard: {
    backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1,
    borderColor: '#334155', overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderColor: '#334155',
  },
  metaLabel: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  metaValue: { fontSize: 13, color: '#CBD5E1', fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  metaHighlight: { color: '#F59E0B' },
  section: { gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  descriptionText: { fontSize: 14, color: '#CBD5E1', lineHeight: 22 },
  emptyResponses: { fontSize: 13, color: '#475569', fontStyle: 'italic' },
  responseCard: {
    backgroundColor: '#1E293B', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#334155', gap: 6,
  },
  responseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  responderName: { fontSize: 13, fontWeight: '700', color: '#E2E8F0' },
  responseDate: { fontSize: 11, color: '#475569' },
  responseBody: { fontSize: 14, color: '#CBD5E1', lineHeight: 20 },
  responseInput: {
    backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#fff', minHeight: 100,
  },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  closeBtn: {
    borderRadius: 10, paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: '#10B981', backgroundColor: '#10B98115',
  },
  closeBtnText: { color: '#10B981', fontSize: 14, fontWeight: '700' },
})
