import { useEffect, useRef, useState } from 'react'
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, StyleSheet, useWindowDimensions,
} from 'react-native'
import type { TypedSupabaseClient } from '@esite/db'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import { FloorPlanAnnotator } from './FloorPlanAnnotator'
import {
  loadPdfForRaster, isPdfPath, isImagePath, withPdfSource, type LoadedPdf,
} from '../../lib/pdf-raster'
import type { AnnotationData, StagedAttachment } from './types'

interface FloorPlan {
  id: string
  name: string
  level: string | null
  file_path: string
  signedUrl?: string
  isPdf?: boolean
}

// What gets fed to the (image-only) annotator: an image URL or a rasterised
// PDF-page file URI, plus the page it came from (for PDF re-edit).
interface AnnotatorSource {
  url: string
  floorPlanId: string | null
  name: string
  pageIndex?: number
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

const planLabel = (p: { name: string; level: string | null }) =>
  `${p.name}${p.level ? ` · ${p.level}` : ''}`

export function FloorPlanAttachModal({
  visible, projectId, client, onClose, onStage, initial,
}: Props) {
  const [plans, setPlans] = useState<FloorPlan[]>([])
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FloorPlan | null>(null)
  const [pdfPages, setPdfPages] = useState<number | null>(null) // >1 → show page picker
  const [preparing, setPreparing] = useState(false)
  const [annotatorSource, setAnnotatorSource] = useState<AnnotatorSource | null>(null)
  const pdfRef = useRef<LoadedPdf | null>(null)
  const { width: winW } = useWindowDimensions()

  const columns = winW >= 1024 ? 4 : winW >= 700 ? 3 : 2
  // 2*list padding + (columns-1)*gap = total gutter
  const cardWidth = Math.floor((winW - 2 * spacing.lg - (columns - 1) * spacing.md) / columns)

  // ── Re-edit: prepare the source (rasterise the stored PDF page if any) ──
  useEffect(() => {
    if (!visible || !initial) return
    let cancelled = false
    ;(async () => {
      const pageIndex = initial.annotationData.sourcePageIndex
      if (pageIndex) {
        try {
          setPreparing(true)
          const pdf = await loadPdfForRaster(initial.sourceImageUrl)
          pdfRef.current = pdf
          const { uri } = await pdf.renderPage(pageIndex)
          if (!cancelled) {
            setAnnotatorSource({ url: uri, floorPlanId: initial.sourceFloorPlanId, name: initial.floorPlanName, pageIndex })
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load PDF page')
        } finally {
          if (!cancelled) setPreparing(false)
        }
      } else {
        setAnnotatorSource({ url: initial.sourceImageUrl, floorPlanId: initial.sourceFloorPlanId, name: initial.floorPlanName })
      }
    })()
    return () => { cancelled = true }
  }, [visible, initial])

  // ── List floor plans (images + PDFs) ──
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

      // Annotatable plans: images AND PDFs (rasterised on pick).
      const supported = rows.filter(r => isImagePath(r.file_path) || isPdfPath(r.file_path))
      const signed = await Promise.all(
        supported.map(async r => {
          const { data: s } = await client.storage.from('drawings').createSignedUrl(r.file_path, 60 * 60)
          return { ...r, signedUrl: s?.signedUrl, isPdf: isPdfPath(r.file_path) }
        }),
      )
      if (!cancelled) { setPlans(signed); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [visible, initial, projectId, client])

  // Best-effort cache cleanup when the modal unmounts.
  useEffect(() => () => { pdfRef.current?.close() }, [])

  async function handlePick(plan: FloorPlan) {
    if (!plan.signedUrl) return
    setError(null)
    if (!plan.isPdf) {
      setAnnotatorSource({ url: plan.signedUrl, floorPlanId: plan.id, name: planLabel(plan) })
      return
    }
    // PDF — load the document, then rasterise (single page) or offer a page picker.
    setPicked(plan)
    setPreparing(true)
    try {
      const pdf = await loadPdfForRaster(plan.signedUrl)
      pdfRef.current = pdf
      if (pdf.numPages === 1) {
        const { uri } = await pdf.renderPage(1)
        setAnnotatorSource({ url: uri, floorPlanId: plan.id, name: planLabel(plan), pageIndex: 1 })
      } else {
        setPdfPages(pdf.numPages)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open PDF floor plan')
    } finally {
      setPreparing(false)
    }
  }

  async function handlePagePick(pageNum: number) {
    if (!pdfRef.current || !picked) return
    setPreparing(true)
    try {
      const { uri } = await pdfRef.current.renderPage(pageNum)
      setAnnotatorSource({ url: uri, floorPlanId: picked.id, name: planLabel(picked), pageIndex: pageNum })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render PDF page')
    } finally {
      setPreparing(false)
    }
  }

  function resetPicker() {
    setAnnotatorSource(null)
    setPicked(null)
    setPdfPages(null)
    pdfRef.current?.close()
    pdfRef.current = null
  }

  if (!visible) return null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {annotatorSource ? (
          <FloorPlanAnnotator
            floorPlanName={annotatorSource.name}
            sourceImageUrl={annotatorSource.url}
            sourceFloorPlanId={annotatorSource.floorPlanId}
            initialAnnotation={initial?.annotationData}
            onCancel={() => {
              if (initial) { pdfRef.current?.close(); onClose() }
              else resetPicker()
            }}
            onSave={({ uri, annotationData, fileName }) => {
              // For PDF sources, record the page and drop the (transient)
              // rasterised image — re-edit re-rasterises from the source PDF.
              const finalData = annotatorSource.pageIndex
                ? withPdfSource(annotationData, annotatorSource.pageIndex)
                : annotationData
              onStage({
                kind: 'annotation',
                id: Math.random().toString(36).slice(2, 10),
                uri,
                mimeType: 'image/png',
                fileName,
                sourceFloorPlanId: annotatorSource.floorPlanId,
                annotationData: finalData,
              })
              pdfRef.current?.close()
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
              <Text style={styles.headerTitle}>
                {pdfPages && pdfPages > 1 ? 'Pick a page' : 'Pick a floor plan'}
              </Text>
              <View style={{ width: 60 }} />
            </View>

            <ScrollView contentContainerStyle={styles.list}>
              {(loading || preparing) && (
                <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
              )}
              {error && <Text style={styles.error}>{error}</Text>}

              {/* Multi-page PDF — page picker */}
              {!preparing && pdfPages && pdfPages > 1 && (
                <View style={styles.pageGrid}>
                  {Array.from({ length: pdfPages }, (_, idx) => idx + 1).map(n => (
                    <TouchableOpacity key={n} style={styles.pageBtn} onPress={() => handlePagePick(n)}>
                      <Text style={styles.pageBtnText}>Page {n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Empty state */}
              {!loading && !preparing && !pdfPages && !error && plans.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No floor plans found</Text>
                  <Text style={styles.emptyDesc}>
                    Upload a floor plan (PDF, PNG or JPG) to this project from the web to mark it up here.
                  </Text>
                </View>
              )}

              {/* Plan grid */}
              {!loading && !preparing && !pdfPages && plans.length > 0 && (
                <View style={styles.grid}>
                  {plans.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => handlePick(p)}
                      style={[styles.card, { width: cardWidth }]}
                    >
                      {p.isPdf ? (
                        <View style={[styles.cardThumb, styles.thumbPlaceholder]}>
                          <Text style={styles.pdfBadge}>PDF</Text>
                        </View>
                      ) : p.signedUrl ? (
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
              )}
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
  pdfBadge: {
    color: colors.textMid, fontSize: fontSize.md, fontWeight: fontWeight.bold, letterSpacing: 1,
  },
  cardBody: { padding: spacing.sm },
  cardName: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.text },
  cardLevel: { fontSize: fontSize.caption, color: colors.textDim, marginTop: 2 },
  pageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  pageBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.panel, minWidth: 96, alignItems: 'center',
  },
  pageBtnText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
})
