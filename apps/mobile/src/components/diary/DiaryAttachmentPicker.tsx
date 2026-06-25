import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as FileSystem from 'expo-file-system'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import type { PendingAttachment } from '../../lib/diary-attachments'

interface Props {
  items: PendingAttachment[]
  onChange: (items: PendingAttachment[]) => void
}

async function compressImage(uri: string): Promise<{ uri: string; size: number }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 2048 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  )
  const info = await FileSystem.getInfoAsync(result.uri)
  return { uri: result.uri, size: info.exists ? info.size : 0 }
}

/** Append only attachments not already selected (dedupe by name + size). */
function mergeUnique(existing: PendingAttachment[], additions: PendingAttachment[]): PendingAttachment[] {
  const seen = new Set(existing.map((a) => `${a.name}|${a.size}`))
  const fresh: PendingAttachment[] = []
  for (const a of additions) {
    const k = `${a.name}|${a.size}`
    if (seen.has(k)) continue
    seen.add(k)
    fresh.push(a)
  }
  return [...existing, ...fresh]
}

export function DiaryAttachmentPicker({ items, onChange }: Props) {
  async function addFromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      videoMaxDuration: 60,
      quality: 0.85,
    })
    await handlePickerResult(res)
  }

  async function addFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Photo library access is required.'); return }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      videoMaxDuration: 60,
      quality: 0.85,
    })
    await handlePickerResult(res)
  }

  async function handlePickerResult(res: ImagePicker.ImagePickerResult) {
    if (res.canceled) return
    const next: PendingAttachment[] = []
    for (const asset of res.assets) {
      const isImage = (asset.type ?? '').startsWith('image')
      if (isImage) {
        // compressImage always re-encodes to JPEG — force name + mime to match so
        // an iPhone HEIC isn't stored with its .HEIC name / image/heic type (which
        // renders as a broken thumbnail on the web diary).
        const compressed = await compressImage(asset.uri)
        const base = (asset.fileName ?? `photo-${Date.now()}`).replace(/\.[^.]+$/, '')
        next.push({ uri: compressed.uri, name: `${base}.jpg`, mimeType: 'image/jpeg', size: compressed.size })
      } else {
        next.push({
          uri: asset.uri,
          name: asset.fileName ?? `video-${Date.now()}.mp4`,
          mimeType: asset.mimeType ?? 'video/mp4',
          size: asset.fileSize ?? 0,
        })
      }
    }
    onChange(mergeUnique(items, next))
  }

  async function addDocument() {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      multiple: true,
    })
    if (res.canceled) return
    onChange(mergeUnique(items, res.assets.map(a => ({
      uri: a.uri,
      name: a.name,
      mimeType: a.mimeType ?? 'application/octet-stream',
      size: a.size ?? 0,
    }))))
  }

  return (
    <View>
      <Text style={styles.label}>Attachments</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={addFromCamera}><Text style={styles.btnText}>📷 Camera</Text></TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={addFromGallery}><Text style={styles.btnText}>🖼 Gallery</Text></TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={addDocument}><Text style={styles.btnText}>📄 File</Text></TouchableOpacity>
      </View>
      {items.map((it, i) => (
        <View key={`${it.name}-${it.size}`} style={styles.item}>
          <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
          <TouchableOpacity onPress={() => onChange(items.filter((_, j) => j !== i))}>
            <Text style={styles.remove}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: 6 },
  btn: { flex: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' },
  btnText: { color: colors.textMid, fontSize: fontSize.small, fontWeight: fontWeight.medium },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  itemName: { flex: 1, color: colors.textMid, fontSize: fontSize.small },
  remove: { color: colors.red, fontSize: fontSize.bodyLg, paddingHorizontal: spacing.sm },
})
