import { useCallback } from 'react'
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Alert, useWindowDimensions,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import type { StagedAttachment } from './types'

interface Props {
  projectId: string | null
  value: StagedAttachment[]
  onChange: (next: StagedAttachment[]) => void
  maxItems?: number
  // Hide the "Floor plan" button when there is no project selected yet.
  allowFloorPlan?: boolean
  /**
   * expo-router href the "Floor plan" button should navigate to. The target
   * screen is expected to return a staged annotation via a shared store /
   * global event — passed as a pathname here to keep this component agnostic.
   */
  floorPlanRoute?: string
  onRequestFloorPlan?: () => void
}

export function AttachmentStaging({
  projectId, value, onChange, maxItems = 10,
  allowFloorPlan = true, onRequestFloorPlan,
}: Props) {
  const router = useRouter()
  const { width: winW } = useWindowDimensions()
  const thumbSize = winW >= 700 ? 110 : 76
  const roomLeft = Math.max(0, maxItems - value.length)
  const pickerDisabled = roomLeft === 0

  const addFromLibrary = useCallback(async () => {
    if (pickerDisabled) return
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Enable photo library access in Settings.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: roomLeft,
    })
    if (result.canceled) return
    const next: StagedAttachment[] = result.assets.slice(0, roomLeft).map(a => ({
      kind: 'file',
      id: Math.random().toString(36).slice(2, 10),
      uri: a.uri,
      mimeType: a.mimeType ?? 'image/jpeg',
      fileName: a.fileName ?? `photo-${Date.now()}.jpg`,
    }))
    onChange([...value, ...next])
  }, [pickerDisabled, roomLeft, value, onChange])

  const addFromCamera = useCallback(async () => {
    if (pickerDisabled) return
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission required', 'Enable camera access in Settings.'); return }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 })
    if (result.canceled || !result.assets[0]) return
    const a = result.assets[0]
    onChange([...value, {
      kind: 'file',
      id: Math.random().toString(36).slice(2, 10),
      uri: a.uri,
      mimeType: a.mimeType ?? 'image/jpeg',
      fileName: a.fileName ?? `photo-${Date.now()}.jpg`,
    }])
  }, [pickerDisabled, value, onChange])

  const openFloorPlan = useCallback(() => {
    if (!projectId) return
    if (onRequestFloorPlan) { onRequestFloorPlan(); return }
    router.push({
      pathname: '/rfis/floor-plan-markup',
      params: { projectId },
    } as any)
  }, [projectId, onRequestFloorPlan, router])

  function remove(id: string) {
    onChange(value.filter(v => v.id !== id))
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Attachments</Text>
        {value.length > 0 && (
          <Text style={styles.count}>{value.length}/{maxItems}</Text>
        )}
      </View>

      {value.length > 0 && (
        <View style={styles.thumbGrid}>
          {value.map(item => (
            <TouchableOpacity
              key={item.id}
              onLongPress={() => remove(item.id)}
              activeOpacity={0.7}
              style={styles.thumbWrap}
            >
              <Image source={{ uri: item.uri }} style={[styles.thumb, { width: thumbSize, height: thumbSize }]} />
              {item.kind === 'annotation' && (
                <View style={styles.markupBadge}>
                  <Text style={styles.markupBadgeText}>MARKUP</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => remove(item.id)}
                style={styles.removeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.removeBtnText}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {value.length > 0 && (
        <Text style={styles.hint}>Long-press to remove</Text>
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={addFromCamera}
          disabled={pickerDisabled}
          style={[styles.actionBtn, pickerDisabled && styles.disabled]}
        >
          <Text style={styles.actionText}>📷  Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={addFromLibrary}
          disabled={pickerDisabled}
          style={[styles.actionBtn, pickerDisabled && styles.disabled]}
        >
          <Text style={styles.actionText}>🖼  Library</Text>
        </TouchableOpacity>
        {allowFloorPlan && projectId && (
          <TouchableOpacity
            onPress={openFloorPlan}
            disabled={pickerDisabled}
            style={[styles.floorPlanBtn, pickerDisabled && styles.disabled]}
          >
            <Text style={styles.floorPlanText}>🗺  Floor plan</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: {
    fontSize: fontSize.small, fontWeight: fontWeight.semibold,
    color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  count: { fontSize: fontSize.caption, color: colors.textDim },
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: 76, height: 76, borderRadius: radius.lg,
    backgroundColor: colors.panel,
  },
  markupBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: colors.amber, borderRadius: 3,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  markupBadgeText: {
    color: colors.base, fontSize: 8, fontWeight: fontWeight.bold, letterSpacing: 0.4,
  },
  removeBtn: {
    position: 'absolute', top: 2, right: 2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtnText: { color: colors.text, fontSize: 14, fontWeight: fontWeight.bold, lineHeight: 16 },
  hint: { fontSize: fontSize.caption, color: colors.textDim },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionBtn: {
    flex: 1, minWidth: 100,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center',
  },
  actionText: { color: colors.textMid, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  floorPlanBtn: {
    flex: 1, minWidth: 120,
    backgroundColor: colors.amberDim, borderWidth: 1, borderColor: colors.amberMid,
    borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center',
  },
  floorPlanText: { color: colors.amber, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  disabled: { opacity: 0.4 },
})
