/**
 * Mobile field-requisition flow — raise a procurement_item from site.
 *
 * Phase 3 slice 2 of the procurement build-out. PM or site lead taps "Raise
 * procurement" on a project, fills a quick form, and the requisition lands
 * in projects.procurement_items at status 'draft'. Optional schedule-line
 * link auto-fills description / qty / unit when the engineer has already
 * scheduled the equipment.
 *
 * Photos are deferred to a follow-up slice — keeping the v1 flow text-only
 * matches what's testable in a phone-first form factor without bloat.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

interface ScheduleStub {
  id: string
  project_id: string
  item_code: string | null
  description: string
  quantity: number
  unit: string | null
}

interface ProjectStub {
  id: string
  name: string
}

export default function CreateProcurementScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ projectId?: string; scheduleId?: string }>()
  const { profile } = useAuth()
  const client = useSupabase()
  const queryClient = useQueryClient()

  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-active', orgId],
    queryFn: async (): Promise<ProjectStub[]> => {
      const { data } = await (client as any)
        .schema('projects')
        .from('projects')
        .select('id, name')
        .eq('organisation_id', orgId)
        .eq('status', 'active')
        .order('name')
      return (data ?? []) as ProjectStub[]
    },
    enabled: !!orgId,
  })

  const { data: scheduleItems = [] } = useQuery({
    queryKey: ['schedule-open', orgId],
    queryFn: async (): Promise<ScheduleStub[]> => {
      const { data } = await (client as any)
        .schema('projects')
        .from('engineer_equipment_schedule')
        .select('id, project_id, item_code, description, quantity, unit')
        .eq('organisation_id', orgId)
        .in('status', ['open', 'partially_ordered'])
        .order('item_code', { ascending: true, nullsFirst: false })
      return (data ?? []) as ScheduleStub[]
    },
    enabled: !!orgId,
  })

  const [projectId, setProjectId] = useState<string>(params.projectId ?? '')
  const [scheduleItemId, setScheduleItemId] = useState<string>(params.scheduleId ?? '')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [requiredBy, setRequiredBy] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<Array<{ uri: string; type: string }>>([])
  const [saving, setSaving] = useState(false)

  // Default to the first project when only one is in scope and nothing was
  // pre-selected via params.
  useEffect(() => {
    if (!projectId && projects.length === 1) setProjectId(projects[0]!.id)
  }, [projects, projectId])

  const scheduleOptions = useMemo(
    () => scheduleItems.filter((s) => s.project_id === projectId),
    [scheduleItems, projectId],
  )

  function onScheduleChange(id: string) {
    setScheduleItemId(id)
    if (!id) return
    const line = scheduleItems.find((s) => s.id === id)
    if (!line) return
    if (!description.trim()) {
      setDescription(line.item_code ? `${line.item_code} — ${line.description}` : line.description)
    }
    if (!quantity) setQuantity(String(Number(line.quantity)))
    if (!unit && line.unit) setUnit(line.unit)
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Allow photo library access.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    })
    if (!result.canceled) {
      setPhotos((p) => [...p, ...result.assets.map((a) => ({ uri: a.uri, type: a.mimeType ?? 'image/jpeg' }))])
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Allow camera access.'); return }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 })
    if (!result.canceled) {
      setPhotos((p) => [...p, { uri: result.assets[0]!.uri, type: result.assets[0]!.mimeType ?? 'image/jpeg' }])
    }
  }

  function removePhoto(idx: number) {
    setPhotos((p) => p.filter((_, i) => i !== idx))
  }

  async function uploadPhotos(itemId: string): Promise<string[]> {
    if (photos.length === 0) return []
    const paths: string[] = []
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!
      const ext = (photo.type.split('/')[1] ?? 'jpg').toLowerCase()
      const path = `${orgId}/${itemId}/${Date.now()}-${i}.${ext}`
      // RN: read URI as Blob via fetch, then upload.
      const resp = await fetch(photo.uri)
      const blob = await resp.blob()
      const { error } = await (client as any).storage
        .from('requisition-photos')
        .upload(path, blob, { contentType: photo.type, upsert: false })
      if (error) throw new Error(`Photo upload failed: ${error.message}`)
      paths.push(path)
    }
    return paths
  }

  async function submit() {
    if (!projectId) { Alert.alert('Required', 'Pick a project.'); return }
    if (!description.trim()) { Alert.alert('Required', 'Description.'); return }
    setSaving(true)
    try {
      const { data, error } = await (client as any)
        .schema('projects')
        .from('procurement_items')
        .insert({
          project_id: projectId,
          organisation_id: orgId,
          created_by: profile!.id,
          description: description.trim(),
          quantity: quantity ? Number(quantity) : null,
          unit: unit.trim() || null,
          required_by: requiredBy || null,
          notes: notes.trim() || null,
          status: 'draft',
          schedule_item_id: scheduleItemId || null,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'Failed to save')
      const itemId = (data as { id: string }).id

      // Upload photos then patch photo_paths on the row. If photo upload
      // fails we keep the row (text is more important than photos) and
      // surface the error.
      if (photos.length > 0) {
        try {
          const paths = await uploadPhotos(itemId)
          await (client as any)
            .schema('projects')
            .from('procurement_items')
            .update({ photo_paths: paths })
            .eq('id', itemId)
        } catch (photoErr: any) {
          Alert.alert('Photo upload failed', `${photoErr.message ?? 'unknown'}. Requisition saved without photos.`)
        }
      }

      queryClient.invalidateQueries({ queryKey: ['procurement', orgId] })
      Alert.alert('Saved', `Requisition raised at status draft${photos.length > 0 ? ` with ${photos.length} photo(s)` : ''}.`)
      router.back()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to raise requisition')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={s.container} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Raise procurement</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={s.form}>
        <Text style={s.label}>Project <Text style={s.required}>*</Text></Text>
        <View style={s.chipRow}>
          {projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => {
                setProjectId(p.id)
                if (scheduleItemId && !scheduleItems.some((s) => s.id === scheduleItemId && s.project_id === p.id)) {
                  setScheduleItemId('')
                }
              }}
              style={[s.chip, projectId === p.id && s.chipActive]}
            >
              <Text style={[s.chipText, projectId === p.id && s.chipTextActive]}>{p.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {scheduleOptions.length > 0 && (
          <>
            <Text style={s.label}>Link to schedule line</Text>
            <View style={s.chipRow}>
              <TouchableOpacity
                onPress={() => setScheduleItemId('')}
                style={[s.chip, !scheduleItemId && s.chipActive]}
              >
                <Text style={[s.chipText, !scheduleItemId && s.chipTextActive]}>Ad-hoc</Text>
              </TouchableOpacity>
              {scheduleOptions.map((line) => (
                <TouchableOpacity
                  key={line.id}
                  onPress={() => onScheduleChange(line.id)}
                  style={[s.chip, scheduleItemId === line.id && s.chipActive]}
                >
                  <Text style={[s.chipText, scheduleItemId === line.id && s.chipTextActive]} numberOfLines={1}>
                    {line.item_code ? `${line.item_code} — ` : ''}{line.description}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={s.label}>Description <Text style={s.required}>*</Text></Text>
        <TextInput
          style={[s.input, s.textarea]}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. 25 mm conduit, 3 m lengths"
          placeholderTextColor={colors.textDim}
          multiline
        />

        <View style={s.row}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={s.label}>Quantity</Text>
            <TextInput
              style={s.input}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              placeholder="50"
              placeholderTextColor={colors.textDim}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Unit</Text>
            <TextInput
              style={s.input}
              value={unit}
              onChangeText={setUnit}
              placeholder="m / each / set"
              placeholderTextColor={colors.textDim}
            />
          </View>
        </View>

        <Text style={s.label}>Required by</Text>
        <TextInput
          style={s.input}
          value={requiredBy}
          onChangeText={setRequiredBy}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.label}>Notes</Text>
        <TextInput
          style={[s.input, s.textarea]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Brand, spec, packaging label…"
          placeholderTextColor={colors.textDim}
          multiline
        />

        <Text style={s.label}>Photos</Text>
        <View style={s.photoRow}>
          <TouchableOpacity onPress={takePhoto} style={s.photoBtn}>
            <Text style={s.photoBtnText}>📷 Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickFromLibrary} style={s.photoBtn}>
            <Text style={s.photoBtnText}>🖼 From library</Text>
          </TouchableOpacity>
        </View>
        {photos.length > 0 && (
          <ScrollView horizontal style={s.thumbScroll} contentContainerStyle={{ gap: spacing.xs }}>
            {photos.map((p, i) => (
              <View key={`${p.uri}-${i}`} style={s.thumbWrap}>
                <Image source={{ uri: p.uri }} style={s.thumb} />
                <TouchableOpacity onPress={() => removePhoto(i)} style={s.thumbRemove}>
                  <Text style={s.thumbRemoveText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        <TouchableOpacity
          onPress={submit}
          disabled={saving || !projectId || description.trim().length < 2}
          style={[s.submit, (saving || !projectId || description.trim().length < 2) && s.submitDisabled]}
        >
          {saving
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={s.submitText}>Raise requisition</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { paddingVertical: spacing.xs },
  backText: { color: colors.amber, fontSize: fontSize.body },
  headerTitle: { fontSize: fontSize.heading, fontWeight: fontWeight.semibold, color: colors.text },
  form: { padding: spacing.md, gap: spacing.sm },
  label: {
    fontSize: fontSize.label, color: colors.textDim,
    marginTop: spacing.sm, marginBottom: spacing.xs,
    fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  required: { color: colors.amber },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, fontSize: fontSize.body,
  },
  textarea: { minHeight: 64, textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  chipActive: { backgroundColor: colors.amberMid, borderColor: colors.amber },
  chipText: { color: colors.text, fontSize: fontSize.small },
  chipTextActive: { color: colors.amber, fontWeight: fontWeight.semibold },
  submit: {
    marginTop: spacing.lg,
    backgroundColor: colors.amber,
    paddingVertical: spacing.md, borderRadius: radius.md,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: colors.bg, fontWeight: fontWeight.semibold, fontSize: fontSize.body },
  photoRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  photoBtn: {
    flex: 1, backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  photoBtnText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  thumbScroll: { marginTop: spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 80, height: 80, borderRadius: radius.sm, backgroundColor: colors.panel },
  thumbRemove: {
    position: 'absolute', top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#dc2626',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontWeight: fontWeight.semibold, fontSize: 14, lineHeight: 16 },
})
