// apps/mobile/app/inspections/[inspectionId]/index.tsx
//
// Capture screen — port of the web inspection capture page to RN.
//
// Reads inspection + template + responses from the locally synced
// PowerSync tables. Field changes write to local SQLite (responses
// table); PowerSync's CRUD layer auto-flushes those mutations upstream
// when connectivity returns.
//
// Submit: flip status to 'awaiting_verification' via PowerSync write
// to the local inspections table (also auto-syncs upstream).

import { useEffect, useMemo, useState } from 'react'
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
import { usePowerSync } from '@powersync/react-native'
import {
  type Response,
  type Template,
  evaluateInspection,
  isFieldVisible,
} from '@esite/shared'
import { useAuth } from '../../../src/providers/AuthProvider'
import { Renderer, type FieldChangePatch } from '../../../src/inspections/FieldRenderers'
import { colors, fontSize, fontWeight, radius, spacing } from '../../../src/theme'

type LocalInspection = {
  id: string
  template_id: string
  target_label: string | null
  status: string
}

type LocalTemplate = {
  id: string
  name: string
  schema_json: string | Record<string, unknown>
}

export default function MobileCaptureScreen() {
  const { inspectionId } = useLocalSearchParams<{ inspectionId: string }>()
  const db = usePowerSync()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [inspection, setInspection] = useState<LocalInspection | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [responses, setResponses] = useState<Response[]>([])
  // Photos table (section_id+field_id) used for min_count enforcement at
  // evaluation time. Signatures intentionally omitted: local schema mirrors
  // server schema where signatures store `role` not section_id/field_id.
  const [photos, setPhotos] = useState<{ section_id: string; field_id: string }[]>([])
  const [activeSection, setActiveSection] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!inspectionId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const inspRs = await db.execute(
          `SELECT id, template_id, target_label, status FROM inspections WHERE id = ?`,
          [inspectionId],
        )
        const insp =
          (inspRs.rows?._array?.[0] as LocalInspection | undefined) ??
          ((inspRs.rows as unknown as LocalInspection[])?.[0] as LocalInspection | undefined)
        if (!insp) {
          if (!cancelled) setLoading(false)
          return
        }

        const tmplRs = await db.execute(
          `SELECT id, name, schema_json FROM templates WHERE id = ?`,
          [insp.template_id],
        )
        const tmplRow =
          (tmplRs.rows?._array?.[0] as LocalTemplate | undefined) ??
          ((tmplRs.rows as unknown as LocalTemplate[])?.[0] as LocalTemplate | undefined)
        const schemaJson = tmplRow
          ? typeof tmplRow.schema_json === 'string'
            ? (JSON.parse(tmplRow.schema_json) as Template)
            : (tmplRow.schema_json as unknown as Template)
          : null

        const respRs = await db.execute(
          `SELECT section_id, field_id, value_bool, value_number, value_text,
                  value_array, value_json, pass_state, fail_reason
           FROM responses WHERE inspection_id = ?`,
          [inspectionId],
        )
        const rawResps =
          (respRs.rows?._array as Array<Record<string, unknown>> | undefined) ??
          ((respRs.rows as unknown as Array<Record<string, unknown>>) ?? [])
        const resps: Response[] = rawResps.map(hydrateResponseRow)

        // Photos — metadata only; engine uses section_id+field_id for min_count
        const photoRs = await db.execute(
          `SELECT section_id, field_id FROM inspection_photos WHERE inspection_id = ?`,
          [inspectionId],
        )
        const rawPhotos =
          (photoRs.rows?._array as Array<Record<string, unknown>> | undefined) ??
          ((photoRs.rows as unknown as Array<Record<string, unknown>>) ?? [])
        const photoMeta = rawPhotos.map((p) => ({
          section_id: String(p.section_id ?? ''),
          field_id: String(p.field_id ?? ''),
        }))

        if (cancelled) return
        setInspection(insp)
        setTemplate(schemaJson)
        setResponses(resps)
        setPhotos(photoMeta)
        setActiveSection(schemaJson?.sections?.[0]?.section_id ?? '')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [db, inspectionId])

  const ev = useMemo(
    () => (template ? evaluateInspection(template, responses, { photos }) : null),
    [template, responses, photos],
  )

  const updateResponse = async (sectionId: string, fieldId: string, patch: FieldChangePatch) => {
    setResponses((prev) => {
      const idx = prev.findIndex((r) => r.section_id === sectionId && r.field_id === fieldId)
      const next = [...prev]
      if (idx === -1) {
        next.push({ section_id: sectionId, field_id: fieldId, ...patch } as Response)
      } else {
        next[idx] = { ...next[idx], ...patch } as Response
      }
      return next
    })

    // Persist to local SQLite — UNIQUE on (inspection_id, section_id, field_id)
    // would be ideal upstream, but for now we DELETE+INSERT for safety so the
    // INSERT OR REPLACE shape matches whatever the eventual constraint is.
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `DELETE FROM responses WHERE inspection_id = ? AND section_id = ? AND field_id = ?`,
        [inspectionId, sectionId, fieldId],
      )
      await tx.execute(
        `INSERT INTO responses (
           inspection_id, section_id, field_id,
           value_bool, value_number, value_text, value_array, value_json,
           pass_state, fail_reason,
           latest_responded_by, latest_responded_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        [
          inspectionId,
          sectionId,
          fieldId,
          patch.value_bool === undefined ? null : patch.value_bool === null ? null : patch.value_bool ? 1 : 0,
          patch.value_number ?? null,
          patch.value_text ?? null,
          patch.value_array != null ? JSON.stringify(patch.value_array) : null,
          patch.value_json != null ? JSON.stringify(patch.value_json) : null,
          patch.pass_state ?? null,
          patch.fail_reason ?? null,
          userId || null,
        ],
      )
    })
  }

  const onSubmit = async () => {
    if (!template || !ev) return
    if (ev.missingRequired.length > 0) {
      Alert.alert(
        'Required fields missing',
        `${ev.missingRequired.length} required field${ev.missingRequired.length === 1 ? '' : 's'} need answers before submitting.`,
      )
      return
    }
    setSubmitting(true)
    try {
      await db.execute(
        `UPDATE inspections
         SET status = 'awaiting_verification',
             completed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
        [inspectionId],
      )
      Alert.alert('Submitted', 'Inspection sent for verification.', [
        { text: 'OK', onPress: () => router.back() },
      ])
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

  if (!inspection || !template) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          Inspection not found locally. It may not be assigned to your org or your device hasn{"’"}t synced yet.
        </Text>
      </View>
    )
  }

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
        {section?.fields.map((field) => {
          if (!isFieldVisible(field, responses)) return null
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
      </ScrollView>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.progressText}>
            {ev?.answeredFieldCount ?? 0}/{ev?.visibleFieldCount ?? 0} answered
            {ev?.overallResult ? ` · ${ev.overallResult}` : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onSubmit}
          disabled={submitting}
          style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
        >
          <Text style={styles.submitText}>{submitting ? 'Submitting...' : 'Submit'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function hydrateResponseRow(row: Record<string, unknown>): Response {
  const arr = row.value_array
  const json = row.value_json
  return {
    section_id: String(row.section_id ?? ''),
    field_id: String(row.field_id ?? ''),
    value_bool:
      row.value_bool === null || row.value_bool === undefined
        ? null
        : Boolean(row.value_bool),
    value_number: row.value_number == null ? null : Number(row.value_number),
    value_text: row.value_text == null ? null : String(row.value_text),
    value_array:
      typeof arr === 'string' && arr.length
        ? (safeParse(arr) as string[] | null) ?? null
        : null,
    value_json: typeof json === 'string' && json.length ? safeParse(json) : null,
    pass_state: (row.pass_state as Response['pass_state']) ?? undefined,
    fail_reason: row.fail_reason == null ? null : String(row.fail_reason),
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
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
