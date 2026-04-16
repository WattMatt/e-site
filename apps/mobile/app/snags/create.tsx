import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image, Platform,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useQueryClient } from '@tanstack/react-query'
import { snagService, storageService } from '@esite/shared'

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
const CATEGORIES = ['electrical', 'mechanical', 'civil', 'safety', 'general']

const PRIORITY_COLOR: Record<string, string> = {
  low: '#6B7280', medium: '#EAB308', high: '#F97316', critical: '#EF4444',
}

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
      // Create the snag
      const snag = await snagService.create(client, orgId, profile!.id, {
        projectId: params.projectId ?? '',
        title: title.trim(),
        description: description.trim() || '',
        location: location.trim() || '',
        category: category || '',
        priority,
      })

      // Upload photos
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
        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.label}>Title <Text style={styles.required}>*</Text></Text>
          <TextInput
            testID="snag-title-input"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Describe the defect…"
            placeholderTextColor="#475569"
            autoFocus
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            testID="snag-description-input"
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Additional details, reference drawings…"
            placeholderTextColor="#475569"
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Location */}
        <View style={styles.field}>
          <Text style={styles.label}>Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Room, floor, grid ref…"
            placeholderTextColor="#475569"
          />
        </View>

        {/* Priority */}
        <View style={styles.field}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.pills}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p}
                testID={`priority-${p}-button`}
                style={[styles.pill, priority === p && { backgroundColor: PRIORITY_COLOR[p] + '33', borderColor: PRIORITY_COLOR[p] }]}
                onPress={() => setPriority(p)}
              >
                <Text style={[styles.pillText, priority === p && { color: PRIORITY_COLOR[p] }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Category */}
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

        {/* Photos */}
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
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit Snag</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderColor: '#1E293B' },
  backBtn: { padding: 4 },
  backText: { color: '#94A3B8', fontSize: 14 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  form: { padding: 16, gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 },
  required: { color: '#EF4444' },
  input: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#fff' },
  textarea: { height: 80, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1E293B' },
  pillText: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  pillActive: { backgroundColor: '#1D4ED820', borderColor: '#3B82F6' },
  pillActiveText: { color: '#3B82F6' },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#1E293B' },
  photoButtons: { flexDirection: 'row', gap: 10 },
  photoBtn: { flex: 1, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  photoBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  photoHint: { fontSize: 11, color: '#475569' },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
