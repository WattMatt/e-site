// apps/mobile/app/inspections/[inspectionId]/index.tsx
//
// Capture screen — port of the web inspection capture page to RN.
//
// Reads the inspection, its template, saved answers and photo slots from
// Supabase as the signed-in user, then lays this device's unsent answers over
// them (src/inspections/response-outbox.ts).
//
// Each answer is written to the local outbox first, so it survives no signal
// and app restarts, and the outbox worker uploads it to inspections.responses
// with the same upsert the web uses. Submit queues one more outbox row that
// uploads only after every earlier answer has landed, and sends ONLY status +
// completed_at (the DB status guard refuses a wider contributor update).
//
// Nothing here writes to PowerSync's synced tables: its upload hook is a no-op,
// and a stuck local write freezes every later download on the device.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import {
  type Response,
  type Template,
  evaluateInspection,
  isFieldVisible,
} from '@esite/shared'
import { useAuth } from '../../../src/providers/AuthProvider'
import { Renderer, type FieldChangePatch } from '../../../src/inspections/FieldRenderers'
import { pendingPhotoSlots } from '../../../src/inspections/attachment-queue'
import {
  type OutboxItem,
  enqueueResponse,
  enqueueSubmit,
  listForInspection,
  mergeOutboxIntoResponses,
  toResponseValues,
} from '../../../src/inspections/response-outbox'
import {
  drainNow,
  inspectionRemote,
  kickOutbox,
  onOutboxChange,
} from '../../../src/inspections/outbox-worker'
import { powerSyncExecutor } from '../../../src/lib/powersync/executor'
import { colors, fontSize, fontWeight, radius, spacing } from '../../../src/theme'

type LoadedInspection = {
  id: string
  template_id: string
  target_label: string | null
  status: string
}

// Statuses in which a contributor may still answer (mirrors
// inspections.user_can_write_responses).
const ANSWERABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required']

export default function MobileCaptureScreen() {
  const { inspectionId } = useLocalSearchParams<{ inspectionId: string }>()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [inspection, setInspection] = useState<LoadedInspection | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [responses, setResponses] = useState<Response[]>([])
  const responsesRef = useRef<Response[]>([])
  // Photo slots (section_id+field_id) used for min_count enforcement: the
  // server's photos plus this device's photos still waiting to upload.
  // Signatures intentionally omitted: they store `role`, not section/field.
  const [photos, setPhotos] = useState<{ section_id: string; field_id: string }[]>([])
  const [outbox, setOutbox] = useState<OutboxItem[]>([])
  const [activeSection, setActiveSection] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const applyResponses = (next: Response[]) => {
    responsesRef.current = next
    setResponses(next)
  }

  const refreshOutbox = useCallback(async () => {
    if (!inspectionId) return
    try {
      setOutbox(await listForInspection(powerSyncExecutor, inspectionId))
    } catch (e) {
      console.warn('[capture] outbox read failed', e)
    }
  }, [inspectionId])

  useEffect(() => onOutboxChange(() => void refreshOutbox()), [refreshOutbox])

  useEffect(() => {
    if (!inspectionId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const bundle = await inspectionRemote.loadCaptureBundle(inspectionId)
        if (!bundle) {
          if (!cancelled) setInspection(null)
          return
        }
        const raw = bundle.template?.schema_json
        const schemaJson = raw
          ? typeof raw === 'string'
            ? (JSON.parse(raw) as Template)
            : (raw as Template)
          : null
        const queued = await listForInspection(powerSyncExecutor, inspectionId)
        const localPhotos = await pendingPhotoSlots(inspectionId)

        if (cancelled) return
        setInspection(bundle.inspection)
        setTemplate(schemaJson)
        applyResponses(mergeOutboxIntoResponses(bundle.responses as unknown as Response[], queued))
        setOutbox(queued)
        setPhotos([...bundle.photos, ...localPhotos])
        setActiveSection(schemaJson?.sections?.[0]?.section_id ?? '')
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message ?? String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [inspectionId, reloadKey])

  const ev = useMemo(
    () => (template ? evaluateInspection(template, responses, { photos }) : null),
    [template, responses, photos],
  )

  const updateResponse = async (sectionId: string, fieldId: string, patch: FieldChangePatch) => {
    if (!inspectionId) return
    const prev = responsesRef.current
    const idx = prev.findIndex((r) => r.section_id === sectionId && r.field_id === fieldId)
    const current: Response = idx === -1 ? { section_id: sectionId, field_id: fieldId } : prev[idx]
    const row = { ...current, ...patch, section_id: sectionId, field_id: fieldId } as Response
    const next = [...prev]
    if (idx === -1) next.push(row)
    else next[idx] = row
    applyResponses(next)

    if (!userId) {
      Alert.alert('Answer not saved', 'Your session has ended. Sign in again to keep capturing.')
      return
    }
    try {
      // The WHOLE merged row, so a later partial edit never blanks an earlier
      // column (e.g. setting fail_reason after pass_state).
      await enqueueResponse(powerSyncExecutor, {
        inspectionId,
        sectionId,
        fieldId,
        responderId: userId,
        values: toResponseValues(row),
        respondedAt: new Date().toISOString(),
      })
      await refreshOutbox()
      kickOutbox()
    } catch (e) {
      Alert.alert('Answer not saved on this device', (e as Error).message ?? 'Unknown error')
    }
  }

  const onSubmit = async () => {
    if (!template || !ev || !inspectionId) return
    if (ev.missingRequired.length > 0) {
      Alert.alert(
        'Required fields missing',
        `${ev.missingRequired.length} required field${ev.missingRequired.length === 1 ? '' : 's'} need answers before submitting.`,
      )
      return
    }
    const refused = outbox.filter((i) => i.kind === 'response' && i.status === 'rejected')
    if (refused.length > 0) {
      Alert.alert(
        'Some answers were refused',
        `${refused.length} answer${refused.length === 1 ? ' was' : 's were'} refused by the server: ${refused[0].lastError ?? 'unknown reason'}. Change ${refused.length === 1 ? 'it' : 'them'} before submitting.`,
      )
      return
    }
    if (!userId) {
      Alert.alert('Not submitted', 'Your session has ended. Sign in again, then submit.')
      return
    }
    setSubmitting(true)
    try {
      await enqueueSubmit(powerSyncExecutor, {
        inspectionId,
        responderId: userId,
        completedAt: new Date().toISOString(),
      })
      // Two passes: the first may be a drain the worker had already started
      // before the submission was queued.
      await drainNow().catch(() => null)
      await drainNow().catch(() => null)
      const left = await listForInspection(powerSyncExecutor, inspectionId)
      setOutbox(left)
      const submitRow = left.find((i) => i.kind === 'submit')
      if (!submitRow) {
        Alert.alert('Submitted', 'Inspection sent for verification.', [
          { text: 'OK', onPress: () => router.back() },
        ])
      } else if (submitRow.status === 'rejected') {
        Alert.alert('Not submitted', submitRow.lastError ?? 'The server refused the submission.')
      } else {
        Alert.alert(
          'Saved on this device',
          'There is no connection right now. Your answers and the submission will upload automatically; the inspection shows as submitted once the server confirms.',
          [{ text: 'OK', onPress: () => router.back() }],
        )
      }
    } catch (e) {
      Alert.alert('Submission failed', (e as Error).message ?? 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.amber} size="large" />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          Could not load this inspection. Check your connection and try again.
        </Text>
        <Text style={styles.errorDetail}>{loadError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => setReloadKey((k) => k + 1)}>
          <Text style={styles.submitText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (!inspection || !template) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {inspection
            ? 'This inspection’s template could not be loaded.'
            : 'Inspection not found. It may have been removed, or it is not on a project you can access.'}
        </Text>
      </View>
    )
  }

  const answerable = ANSWERABLE_STATUSES.includes(inspection.status)
  const refused = outbox.filter((i) => i.status === 'rejected')
  const waiting = outbox.filter((i) => i.status !== 'rejected')
  const submitQueued = waiting.some((i) => i.kind === 'submit')
  const lastAttemptError = waiting.find((i) => i.status === 'failed')?.lastError ?? null

  const section = template.sections.find((s) => s.section_id === activeSection)

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {inspection.target_label ?? '(no label)'}
        </Text>
        <Text style={styles.subtitle}>{template.name}</Text>
      </View>

      {/* Upload state — what has not reached the server, and why */}
      {!answerable && (
        <View style={[styles.notice, styles.noticeInfo]} testID="capture-not-answerable">
          <Text style={styles.noticeText}>
            This inspection is {inspection.status.replace(/_/g, ' ')}; answers can no longer be changed.
          </Text>
        </View>
      )}
      {refused.length > 0 && (
        <View style={[styles.notice, styles.noticeError]} testID="capture-refused">
          <Text style={styles.noticeText}>
            {refused.length} change{refused.length === 1 ? ' was' : 's were'} refused by the server:{' '}
            {refused[0].lastError ?? 'unknown reason'}
          </Text>
        </View>
      )}
      {waiting.length > 0 && (
        <View style={[styles.notice, styles.noticeWarn]} testID="capture-waiting">
          <Text style={styles.noticeText}>
            {submitQueued
              ? 'Submission waiting to upload'
              : `${waiting.length} change${waiting.length === 1 ? '' : 's'} waiting to upload`}
            {lastAttemptError ? ` — last attempt: ${lastAttemptError}` : ''}
          </Text>
        </View>
      )}

      {/* Section tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {template.sections.map((s) => {
          const isActive = s.section_id === activeSection
          return (
            <Pressable
              key={s.section_id}
              onPress={() => setActiveSection(s.section_id)}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{s.title}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Fields */}
      <ScrollView style={styles.fieldsScroll} contentContainerStyle={styles.fieldsContent}>
        {section && (section.fields ?? []).map((field) => {
          if (!isFieldVisible(field, responses, { section })) return null
          const response = responses.find(
            (r) => r.section_id === section.section_id && r.field_id === field.field_id,
          )
          return (
            <View key={field.field_id} style={styles.fieldWrap}>
              <Renderer
                field={field}
                response={response}
                inspectionId={inspectionId!}
                sectionId={section.section_id}
                onChange={(patch) => updateResponse(section.section_id, field.field_id, patch)}
              />
            </View>
          )
        })}
        {section && (section.subsections ?? []).map((ss) => {
          // Subsection-level conditional_on
          if (ss.conditional_on) {
            const probe = { ...ss.fields[0], conditional_on: ss.conditional_on }
            if (!isFieldVisible(probe, responses, { section })) return null
          }
          return (
            <View key={ss.subsection_id} style={styles.subsectionWrap}>
              <Text style={styles.subsectionTitle}>{ss.title}</Text>
              {ss.fields.map((field) => {
                if (!isFieldVisible(field, responses, { section, subsection: ss })) return null
                const response = responses.find(
                  (r) => r.section_id === section.section_id && r.field_id === field.field_id,
                )
                return (
                  <View key={field.field_id} style={styles.fieldWrap}>
                    <Renderer
                      field={field}
                      response={response}
                      inspectionId={inspectionId!}
                      sectionId={section.section_id}
                      onChange={(patch) => updateResponse(section.section_id, field.field_id, patch)}
                    />
                  </View>
                )
              })}
            </View>
          )
        })}
      </ScrollView>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.progressText}>
            {ev?.answeredFieldCount ?? 0}/{ev?.visibleFieldCount ?? 0} answered
            {ev?.overallResult ? ` · ${ev.overallResult}` : ''}
          </Text>
        </View>
        {answerable && (
          <TouchableOpacity
            onPress={onSubmit}
            disabled={submitting || submitQueued}
            style={[styles.submitBtn, (submitting || submitQueued) && { opacity: 0.5 }]}
          >
            <Text style={styles.submitText}>
              {submitting ? 'Submitting...' : submitQueued ? 'Queued' : 'Submit'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.base,
  },
  errorText: { color: colors.textMid, fontSize: fontSize.md, textAlign: 'center' },
  errorDetail: {
    color: colors.textMid,
    fontSize: fontSize.small,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  retryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.amber,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  notice: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  noticeInfo: { backgroundColor: colors.elevated, borderColor: colors.borderMid },
  noticeWarn: { backgroundColor: colors.amberDim, borderColor: colors.amberMid },
  noticeError: { backgroundColor: colors.redDim, borderColor: colors.redMid },
  noticeText: { color: colors.text, fontSize: fontSize.small },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  subtitle: { color: colors.textMid, fontSize: fontSize.small, marginTop: spacing.xs },
  tabBar: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMid,
  },
  tabBarContent: { paddingHorizontal: spacing.md, gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  tabActive: { backgroundColor: colors.amberDim },
  tabText: { color: colors.textMid, fontSize: fontSize.bodyLg, fontWeight: fontWeight.medium },
  tabTextActive: { color: colors.amber, fontWeight: fontWeight.semibold },
  fieldsScroll: { flex: 1 },
  fieldsContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  fieldWrap: { marginBottom: spacing.lg },
  subsectionWrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderMid,
  },
  subsectionTitle: {
    color: colors.textMid,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderMid,
    backgroundColor: colors.surface,
  },
  progressText: { color: colors.textMid, fontSize: fontSize.small },
  submitBtn: {
    backgroundColor: colors.amber,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  submitText: { color: colors.base, fontWeight: fontWeight.bold, fontSize: fontSize.md },
})
