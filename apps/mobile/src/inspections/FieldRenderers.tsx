// apps/mobile/src/inspections/FieldRenderers.tsx
//
// React Native field renderers for the mobile inspection capture screen.
//
// Mirrors the per-type renderers on web (apps/web/src/components/inspections/fields/*)
// but consolidated into ONE file because RN doesn't benefit from
// per-file splits (no tree-shaking story like web bundlers).
//
// Uses the shared evaluation engine (@esite/shared) so pass/fail logic
// is identical on web + mobile. The dispatcher `Renderer` switches on
// field.type and falls through to a friendly "not supported on mobile"
// message for v2 types.

import { useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { evaluateField, type Field, type Response } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../theme'
import { enqueueAttachment } from './attachment-queue'

export type FieldChangePatch = Partial<Response> & {
  value_bool?: boolean | null
  value_number?: number | null
  value_text?: string | null
  value_array?: string[] | null
  value_json?: Record<string, unknown> | null
  pass_state?: string | null
  fail_reason?: string | null
}

export interface RendererProps {
  field: Field
  response: Response | undefined
  inspectionId: string
  sectionId: string
  onChange: (patch: FieldChangePatch) => void
}

export function Renderer(props: RendererProps): JSX.Element | null {
  const { field } = props
  switch (field.type) {
    case 'pass_fail':
      return <PassFailField {...props} />
    case 'number':
      return <NumberField {...props} />
    case 'text':
    case 'textarea':
      return <TextField {...props} />
    case 'date':
      return <DateField {...props} />
    case 'dropdown':
    case 'multi_select':
      return <ChoiceField {...props} />
    case 'photo':
      return (
        <PhotoField
          field={props.field}
          inspectionId={props.inspectionId}
          sectionId={props.sectionId}
        />
      )
    case 'header':
      return <HeaderField field={props.field} />
    case 'signature':
      return (
        <StubField label={props.field.label} note="Signature capture — use web for v1" />
      )
    case 'computed':
    case 'file':
      return <StubField label={props.field.label} note="Not supported on mobile yet" />
    default:
      return null
  }
}

// ─── Pass / fail ─────────────────────────────────────────────────────

function PassFailField({ field, response, onChange }: RendererProps) {
  const isPass = response?.value_bool === true
  const isFail = response?.value_bool === false
  return (
    <View>
      <FieldLabel field={field} />
      <View style={styles.passFailRow}>
        <TouchableOpacity
          onPress={() =>
            onChange({ value_bool: true, pass_state: 'pass', fail_reason: null })
          }
          style={[
            styles.passFailBtn,
            isPass && { borderColor: colors.green, backgroundColor: colors.greenDim },
          ]}
        >
          <Text style={[styles.passFailText, isPass && { color: colors.green }]}>
            {String.fromCharCode(0x2713)} Pass
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onChange({ value_bool: false, pass_state: 'fail' })}
          style={[
            styles.passFailBtn,
            isFail && { borderColor: colors.red, backgroundColor: colors.redDim },
          ]}
        >
          <Text style={[styles.passFailText, isFail && { color: colors.red }]}>
            {String.fromCharCode(0x2717)} Fail
          </Text>
        </TouchableOpacity>
      </View>
      {isFail ? (
        <TextInput
          placeholder="Reason for failure"
          placeholderTextColor={colors.textDim}
          value={response?.fail_reason ?? ''}
          onChangeText={(t) => onChange({ value_bool: false, fail_reason: t, pass_state: 'fail' })}
          style={[styles.input, { marginTop: spacing.sm }]}
        />
      ) : null}
    </View>
  )
}

// ─── Number ─────────────────────────────────────────────────────────

function NumberField({ field, response, sectionId, onChange }: RendererProps) {
  const ev = evaluateField(field, response ?? {
    section_id: sectionId,
    field_id: field.field_id,
  } as unknown as Response)
  return (
    <View>
      <FieldLabel field={field} />
      <View style={styles.numberRow}>
        <TextInput
          keyboardType="decimal-pad"
          value={response?.value_number != null ? String(response.value_number) : ''}
          onChangeText={(t) =>
            onChange({
              value_number: t === '' ? null : Number.parseFloat(t),
            })
          }
          style={[styles.input, { flex: 1 }]}
          placeholderTextColor={colors.textDim}
        />
        {field.unit ? <Text style={styles.unit}>{field.unit}</Text> : null}
      </View>
      {field.pass_when ? (
        <Text
          style={[
            styles.helper,
            ev.passState === 'pass' && { color: colors.green },
            ev.passState === 'fail' && { color: colors.red },
          ]}
        >
          {field.pass_when}
          {ev.passState !== 'not_checked' ? ` (${ev.passState})` : ''}
        </Text>
      ) : null}
    </View>
  )
}

// ─── Text / textarea ─────────────────────────────────────────────────

function TextField({ field, response, onChange }: RendererProps) {
  const multi = field.type === 'textarea'
  return (
    <View>
      <FieldLabel field={field} />
      <TextInput
        multiline={multi}
        value={response?.value_text ?? ''}
        onChangeText={(t) => onChange({ value_text: t })}
        placeholderTextColor={colors.textDim}
        style={[styles.input, multi && { minHeight: 96, textAlignVertical: 'top' }]}
      />
    </View>
  )
}

// ─── Date (text-input v1) ────────────────────────────────────────────

function DateField({ field, response, onChange }: RendererProps) {
  return (
    <View>
      <FieldLabel field={field} />
      <TextInput
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textDim}
        value={response?.value_text ?? ''}
        onChangeText={(t) => onChange({ value_text: t })}
        style={styles.input}
      />
    </View>
  )
}

// ─── Dropdown / multi-select (toggle pills) ─────────────────────────

function ChoiceField({ field, response, onChange }: RendererProps) {
  const isMulti = field.type === 'multi_select'
  const options = (field.options as string[] | undefined) ?? []
  return (
    <View>
      <FieldLabel field={field} />
      <View style={styles.chipsRow}>
        {options.map((opt) => {
          const selected = isMulti
            ? (response?.value_array ?? []).includes(opt)
            : response?.value_text === opt
          return (
            <Pressable
              key={opt}
              onPress={() => {
                if (isMulti) {
                  const cur = response?.value_array ?? []
                  onChange({
                    value_array: selected
                      ? cur.filter((x) => x !== opt)
                      : [...cur, opt],
                  })
                } else {
                  onChange({ value_text: opt })
                }
              }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ─── Photo ──────────────────────────────────────────────────────────

function PhotoField({
  field,
  inspectionId,
  sectionId,
}: {
  field: Field
  inspectionId: string
  sectionId: string
}) {
  const [enqueueing, setEnqueueing] = useState(false)
  const [lastEnqueued, setLastEnqueued] = useState<number>(0)

  const onPick = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Camera permission required')
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 1,
      })
      if (result.canceled || !result.assets?.[0]) return

      setEnqueueing(true)
      const uri = result.assets[0].uri
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 2048 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      )

      const dir = `${FileSystem.documentDirectory}inspection-attachments`
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
      const id = Crypto.randomUUID()
      const localCopy = `${dir}/${id}.jpg`
      await FileSystem.copyAsync({ from: compressed.uri, to: localCopy })

      // remote_path uses __placeholder__/<inspection_id>/... — the upload
      // worker resolves this to <project_id>/<inspection_id>/... at upload
      // time via lookupProjectId().
      const remotePath = `__placeholder__/${inspectionId}/${sectionId}/${field.field_id}/${Date.now()}.jpg`
      await enqueueAttachment({
        id,
        inspection_id: inspectionId,
        bucket: 'inspection-photos',
        local_path: localCopy,
        remote_path: remotePath,
        section_id: sectionId,
        field_id: field.field_id,
        signature_role: null,
        signatory_name: null,
        signatory_title: null,
        registration_number: null,
        caption: null,
      })
      setLastEnqueued((n) => n + 1)
    } catch (e) {
      Alert.alert('Photo capture failed', (e as Error).message ?? 'Unknown error')
    } finally {
      setEnqueueing(false)
    }
  }

  return (
    <View>
      <FieldLabel field={field} />
      <Pressable
        onPress={onPick}
        disabled={enqueueing}
        style={[styles.photoBtn, enqueueing && { opacity: 0.5 }]}
      >
        <Text style={styles.photoBtnText}>
          {enqueueing ? 'Saving...' : 'Take photo'}
        </Text>
      </Pressable>
      {lastEnqueued > 0 ? (
        <Text style={styles.helper}>
          {lastEnqueued} photo{lastEnqueued === 1 ? '' : 's'} queued for upload
        </Text>
      ) : null}
    </View>
  )
}

// ─── Header (sub-heading inside a section) ──────────────────────────

function HeaderField({ field }: { field: Field }) {
  return <Text style={styles.sectionHeader}>{field.label}</Text>
}

// ─── Stub (unsupported on mobile in v1) ─────────────────────────────

function StubField({ label, note }: { label: string; note: string }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.stubNote}>{note}</Text>
    </View>
  )
}

// ─── Shared label ───────────────────────────────────────────────────

function FieldLabel({ field }: { field: Field }) {
  return (
    <Text style={styles.label}>
      {field.label}
      {field.required ? <Text style={{ color: colors.red }}> *</Text> : null}
    </Text>
  )
}

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  helper: { fontSize: fontSize.caption, color: colors.textMid, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.borderMid,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  passFailRow: { flexDirection: 'row', gap: spacing.sm },
  passFailBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMid,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  passFailText: { color: colors.textMid, fontWeight: fontWeight.semibold, fontSize: fontSize.md },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unit: { color: colors.textMid, fontSize: fontSize.bodyLg },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderMid,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.amber, backgroundColor: colors.amberDim },
  chipText: { color: colors.textMid, fontSize: fontSize.small },
  chipTextSelected: { color: colors.amber, fontWeight: fontWeight.semibold },
  photoBtn: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.borderMid,
    alignItems: 'center',
  },
  photoBtnText: { color: colors.amber, fontWeight: fontWeight.semibold, fontSize: fontSize.md },
  sectionHeader: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  stubNote: { color: colors.textMid, fontSize: fontSize.small, fontStyle: 'italic' },
})
