import { useState } from 'react'
import {
  View, Text, Image, TouchableOpacity, Modal,
  ActivityIndicator, StyleSheet, Alert, ScrollView,
} from 'react-native'
import type { TypedSupabaseClient } from '@esite/db'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import { FloorPlanAttachModal } from './FloorPlanAttachModal'
import { replaceAnnotation, deleteAttachment } from './commit'
import type { PersistedAttachment } from './types'

interface Props {
  attachments: PersistedAttachment[]
  canEdit: boolean
  projectId: string
  client: TypedSupabaseClient
  onChanged?: () => void
}

const IMG_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic']

export function AttachmentGallery({ attachments, canEdit, projectId, client, onChanged }: Props) {
  const [lightbox, setLightbox] = useState<PersistedAttachment | null>(null)
  const [editing, setEditing] = useState<{
    attachment: PersistedAttachment
    sourceUrl: string
    floorPlanName: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (attachments.length === 0) return null

  async function handleReEdit(a: PersistedAttachment) {
    if (!a.annotation) return
    let sourceUrl: string | null = null
    let planName = a.file_name

    if (a.annotation.source_floor_plan_id) {
      const { data: plan } = await client
        .schema('tenants')
        .from('floor_plans')
        .select('name, level, file_path')
        .eq('id', a.annotation.source_floor_plan_id)
        .single()

      if (plan) {
        planName = `${plan.name}${plan.level ? ` · ${plan.level}` : ''}`
        const { data: signed } = await client.storage
          .from('drawings')
          .createSignedUrl(plan.file_path, 60 * 60)
        sourceUrl = signed?.signedUrl ?? null
      }
    }
    if (!sourceUrl) {
      sourceUrl = a.annotation.annotation_data.baseImage.signedUrl ?? null
    }
    if (!sourceUrl) {
      Alert.alert('Unavailable', 'Source floor plan is no longer accessible.')
      return
    }
    setEditing({ attachment: a, sourceUrl, floorPlanName: planName })
  }

  function handleDelete(a: PersistedAttachment) {
    if (!canEdit) return
    Alert.alert('Delete attachment?', a.file_name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusy(a.id)
          try {
            await deleteAttachment({ client, attachmentId: a.id, filePath: a.file_path })
            onChanged?.()
          } catch (e: any) {
            Alert.alert('Delete failed', e?.message ?? 'Unknown error')
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row}>
        <View style={styles.grid}>
          {attachments.map(a => {
            const isImage = a.mime_type && IMG_MIMES.includes(a.mime_type)
            const isAnnotation = !!a.annotation
            return (
              <View key={a.id} style={styles.tile}>
                <TouchableOpacity
                  onPress={() => isImage && setLightbox(a)}
                  onLongPress={() => canEdit && handleDelete(a)}
                  activeOpacity={0.8}
                >
                  {isImage && a.signedUrl ? (
                    <Image source={{ uri: a.signedUrl }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <Text style={styles.placeholderText}>PDF</Text>
                    </View>
                  )}
                </TouchableOpacity>
                {isAnnotation && (
                  <View style={styles.markupBadge}>
                    <Text style={styles.markupBadgeText}>MARKUP</Text>
                  </View>
                )}
                {busy === a.id && (
                  <View style={styles.busyOverlay}>
                    <ActivityIndicator color={colors.amber} />
                  </View>
                )}
                {canEdit && isAnnotation && (
                  <TouchableOpacity
                    onPress={() => handleReEdit(a)}
                    style={styles.editBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.editBtnText}>✎</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })}
        </View>
      </ScrollView>

      {lightbox && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
          <TouchableOpacity
            style={styles.lightboxBg}
            activeOpacity={1}
            onPress={() => setLightbox(null)}
          >
            {lightbox.signedUrl && (
              <Image source={{ uri: lightbox.signedUrl }} style={styles.lightboxImg} resizeMode="contain" />
            )}
          </TouchableOpacity>
        </Modal>
      )}

      {editing && (
        <FloorPlanAttachModal
          visible
          projectId={projectId}
          client={client}
          onClose={() => setEditing(null)}
          initial={{
            sourceFloorPlanId: editing.attachment.annotation!.source_floor_plan_id,
            sourceImageUrl: editing.sourceUrl,
            floorPlanName: editing.floorPlanName,
            annotationData: editing.attachment.annotation!.annotation_data,
          }}
          onStage={async staged => {
            if (staged.kind !== 'annotation') return
            setBusy(editing.attachment.id)
            try {
              await replaceAnnotation({
                client,
                attachmentId: editing.attachment.id,
                annotationId: editing.attachment.annotation!.id,
                uri: staged.uri,
                annotationData: staged.annotationData,
              })
              onChanged?.()
            } catch (e: any) {
              Alert.alert('Save failed', e?.message ?? 'Unknown error')
            } finally {
              setBusy(null)
              setEditing(null)
            }
          }}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexGrow: 0 },
  grid: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  tile: {
    position: 'relative', width: 100,
    borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
  },
  thumb: { width: 100, height: 100, backgroundColor: colors.surface },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: {
    color: colors.textMid, fontSize: fontSize.md, fontWeight: fontWeight.bold, letterSpacing: 1,
  },
  markupBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: colors.amber, borderRadius: 3,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  markupBadgeText: { color: colors.base, fontSize: 8, fontWeight: fontWeight.bold, letterSpacing: 0.4 },
  editBtn: {
    position: 'absolute', top: 4, right: 4,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.amberDim, borderWidth: 1, borderColor: colors.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  editBtnText: { color: colors.amber, fontSize: 12, fontWeight: fontWeight.bold },
  busyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  lightboxBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center',
  },
  lightboxImg: { width: '100%', height: '100%' },
})
