import { useState } from 'react'
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useQueryClient } from '@tanstack/react-query'
import { snagService, storageService } from '@esite/shared'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing } from '../../src/theme'

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
const CATEGORIES = ['electrical', 'mechanical', 'civil', 'safety', 'general']

export default function CreateSnagScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ projectId?: string }>()
  const { profile } = useAuth()
  const client = useSupabase()
  const queryClient = useQueryClient()

  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('medium')
  const [photos, setPhotos] = useState<Array<{ uri: string; type: string }>>([])
  const [saving, setSaving] = useState(false)

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Allow photo library access in Settings.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    })
    if (!result.canceled) {
      setPhotos(prev => [
        ...prev,
        ...result.assets.map(a => ({ uri: a.uri, type: a.mimeType ?? 'image/jpeg' })),
      ])
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Allow camera access in Settings.'); return }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 })
    if (!result.canceled) {
      setPhotos(prev => [...prev, { uri: result.assets[0].uri, type: result.assets[0].mimeType ?? 'image/jpeg' }])
    }
  }

  async function submit() {
    if (!title.trim()) { Alert.alert('Required', 'Please enter a title.'); return }
    if (!params.projectId && !orgId) { Alert.alert('Error', 'No project selected.'); return }
    if (!orgId) { Alert.alert('Error', 'No organisation found.'); return }

    setSaving(true)
    try {
      const snag = await snagService.create(client, orgId, profile!.id, {
        projectId: params.projectId ?? '',
        title: title.trim(),
        description: description.trim() || '',
        location: location.trim() || '',
        category: category || '',
        priority,
      })

      if (photos.length > 0) {
        await Promise.all(photos.map(async (photo, i) => {
          const ext = photo.type.split('/')[1] ?? 'jpg'
          const path = storageService.snagPhotoPath(orgId, snag.project_id, snag.id, `${Date.now()}-${i}.${ext}`)
          await storageService.uploadFromUri(client, 'snag-photos', path, photo.uri, photo.type)
          await client.schema('field').from('snag_photos').insert({
            snag_id: snag.id,
            file_path: path,
            photo_type: 'defect',
            sort_order: i,
          })
        }))
      }

      queryClient.invalidateQueries({ queryKey: ['snags', snag.project_id] })
      queryClient.invalidateQueries({ queryKey: ['snags-org', orgId] })
      router.replace(`/snags/${snag.id}` as any)
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to create snag')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView testID="snag-create-screen" style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Snag</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
          <TextInput
            testID="snag-title-input"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Describe the defect…"
            placeholderTextColor={colors.textDim}
            autoFocus
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            testID="snag-description-input"
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Additional details, reference drawings…"
            placeholderTextColor={colors.textDim}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Room, floor, grid ref…"
            placeholderTextColor={colors.textDim}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.pills}>
            {PRIORITIES.map(p => {
              const accent = priorityColor(p)
              const active = priority === p
              return (
                <TouchableOpacity
                  key={p}
                  testID={`priority-${p}-button`}
                  style={[styles.pill, active && { backgroundColor: colors.elevated, borderColor: accent }]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[styles.pillText, active && { color: accent }]}>{p}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.pills}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.pill, category === c && styles.pillActive]}
                onPress={() => setCategory(c === category ? '' : c)}
              >
                <Text style={[styles.pillText, category === c && styles.pillActiveText]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Photos</Text>
          <View style={styles.photoRow}>
            {photos.map((p, i) => (
              <TouchableOpacity key={i} onLongPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}>
                <Image source={{ uri: p.uri }} style={styles.thumb} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.photoButtons}>
            <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
              <Text style={styles.photoBtnText}>📷  Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
              <Text style={styles.photoBtnText}>🖼  Library</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 && <Text style={styles.photoHint}>Long-press a photo to remove</Text>}
        </View>

        <TouchableOpacity testID="snag-submit-button" style={[styles.submitBtn, saving && styles.submitDisabled]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.base} /> : <Text style={styles.submitText}>Submit Snag</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  form: { padding: spacing.lg, gap: spacing.xl },
  field: { gap: spacing.sm },
  label: { fontSize: fontSize.small, fontWeight: fontWeight.semibold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  required: { color: colors.red },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.md,
    fontSize: fontSize.bodyLg, color: colors.text,
  },
  textarea: { height: 80, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  pillText: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium, textTransform: 'capitalize' },
  pillActive: { backgroundColor: colors.amberDim, borderColor: colors.amberMid },
  pillActiveText: { color: colors.amber },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.lg, backgroundColor: colors.panel },
  photoButtons: { flexDirection: 'row', gap: spacing.sm + 2 },
  photoBtn: { flex: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  photoBtnText: { color: colors.textMid, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  photoHint: { fontSize: fontSize.caption, color: colors.textDim },
  submitBtn: { backgroundColor: colors.amber, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.base, fontSize: fontSize.base, fontWeight: fontWeight.bold },
})
