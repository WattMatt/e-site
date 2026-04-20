import { useEffect, useState } from 'react'
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, StyleSheet, useWindowDimensions,
} from 'react-native'
import type { TypedSupabaseClient } from '@esite/db'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import { FloorPlanAnnotator } from './FloorPlanAnnotator'
import type { AnnotationData, StagedAttachment } from './types'

interface FloorPlan {
  id: string
  name: string
  level: string | null
  file_path: string
  signedUrl?: string
}

interface Props {
  visible: boolean
  projectId: string
  client: TypedSupabaseClient
  onClose: () => void
  onStage: (staged: Extract<StagedAttachment, { kind: 'annotation' }>) => void
  // If supplied, opens the annotator straight into re-edit mode.
  initial?: {
    sourceFloorPlanId: string | null
    sourceImageUrl: string
    floorPlanName: string
    annotationData: AnnotationData
  }
}

export function FloorPlanAttachModal({
  visible, projectId, client, onClose, onStage, initial,
}: Props) {
  const [plans, setPlans] = useState<FloorPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FloorPlan | null>(null)
  const { width: winW } = useWindowDimensions()

  const columns = winW >= 1024 ? 4 : winW >= 700 ? 3 : 2
  // 2*list padding + (columns-1)*gap = total gutter
  const cardWidth = Math.floor((winW - 2 * spacing.lg - (columns - 1) * spacing.md) / columns)

  useEffect(() => {
    if (!visible || initial) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const { data, error } = await client
        .schema('tenants')
        .from('floor_plans')
        .select('id, name, level, file_path')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      const rows = (data ?? []) as FloorPlan[]
      const imageRows = rows.filter(r => /\.(png|jpe?g|webp|heic)$/i.test(r.file_path))
      const signed = await Promise.all(
        imageRows.map(async r => {
          const { data: s } = await client.storage.from('drawings').createSignedUrl(r.file_path, 60 * 60)
          return { ...r, signedUrl: s?.signedUrl }
        }),
      )
      if (!cancelled) { setPlans(signed); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [visible, initial, projectId, client])

  const activeSource: FloorPlan | null = initial
    ? {
        id: initial.sourceFloorPlanId ?? 'source-deleted',
        name: initial.floorPlanName,
        level: null,
        file_path: '',
        signedUrl: initial.sourceImageUrl,
      }
    : picked

  if (!visible) return null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {activeSource?.signedUrl ? (
          <FloorPlanAnnotator
            floorPlanName={`${activeSource.name}${activeSource.level ? ` · ${activeSource.level}` : ''}`}
            sourceImageUrl={activeSource.signedUrl}
            sourceFloorPlanId={activeSource.id === 'source-deleted' ? null : activeSource.id}
            initialAnnotation={initial?.annotationData}
            onCancel={() => {
              if (initial) onClose()
              else setPicked(null)
            }}
            onSave={({ uri, annotationData, fileName }) => {
              onStage({
                kind: 'annotation',
                id: Math.random().toString(36).slice(2, 10),
                uri,
                mimeType: 'image/png',
                fileName,
                sourceFloorPlanId: activeSource.id === 'source-deleted' ? null : activeSource.id,
                annotationData,
              })
              setPicked(null)
              onClose()
            }}
          />
        ) : (
          <>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.backText}>← Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Pick a floor plan</Text>
              <View style={{ width: 60 }} />
            </View>

            <ScrollView contentContainerStyle={styles.list}>
              {loading && (
                <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
              )}
              {error && <Text style={styles.error}>{error}</Text>}
              {!loading && !error && plans.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No image floor plans</Text>
                  <Text style={styles.emptyDesc}>
                    Upload a PNG or JPG floor plan to this project from the web to mark it up here.
                  </Text>
                </View>
              )}
              <View style={styles.grid}>
                {plans.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setPicked(p)}
                    style={[styles.card, { width: cardWidth }]}
                  >
                    {p.signedUrl ? (
                      <Image source={{ uri: p.signedUrl }} style={styles.cardThumb} />
                    ) : (
                      <View style={[styles.cardThumb, styles.thumbPlaceholder]} />
                    )}
                    <View style={styles.cardBody}>
                      <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
                      {p.level && <Text style={styles.cardLevel}>{p.level}</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  list: { padding: spacing.lg },
  error: { color: colors.red, fontSize: fontSize.body, marginVertical: spacing.lg },
  empty: {
    padding: spacing.xl, alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.lg,
  },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.sm },
  emptyDesc: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center', lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden',
  },
  cardThumb: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surface },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: spacing.sm },
  cardName: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.text },
  cardLevel: { fontSize: fontSize.caption, color: colors.textDim, marginTop: 2 },
})
