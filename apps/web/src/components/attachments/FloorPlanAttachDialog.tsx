'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Map, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { loadPdfForRaster, isPdfPath, isImagePath, type LoadedPdf } from '@/lib/pdf-raster'
import { FloorPlanAnnotator } from './FloorPlanAnnotator'
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
// PDF-page data URL, plus the page it came from (for PDF re-edit).
interface AnnotatorSource {
  url: string
  floorPlanId: string | null
  name: string
  pageIndex?: number
}

interface Props {
  projectId: string
  onClose: () => void
  onStage: (staged: Extract<StagedAttachment, { kind: 'annotation' }>) => void
  // When re-editing an existing annotation, pass the source plan + prior scene graph.
  initial?: {
    sourceFloorPlanId: string | null
    sourceImageUrl: string
    floorPlanName: string
    annotationData: AnnotationData
  }
}

const planLabel = (p: { name: string; level: string | null }) =>
  `${p.name}${p.level ? ` · ${p.level}` : ''}`

export function FloorPlanAttachDialog({ projectId, onClose, onStage, initial }: Props) {
  const [plans, setPlans] = useState<FloorPlan[]>([])
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState<string | null>(null)

  const [picked, setPicked] = useState<FloorPlan | null>(null)
  const [pdfPages, setPdfPages] = useState<number | null>(null) // >1 → show page picker
  const [preparing, setPreparing] = useState(false)
  const [annotatorSource, setAnnotatorSource] = useState<AnnotatorSource | null>(null)
  const pdfRef = useRef<LoadedPdf | null>(null)

  // ── Re-edit: prepare the source (rasterise the stored PDF page if any) ──
  useEffect(() => {
    if (!initial) return
    let cancelled = false
    ;(async () => {
      const pageIndex = initial.annotationData.sourcePageIndex
      if (pageIndex) {
        try {
          setPreparing(true)
          const pdf = await loadPdfForRaster(initial.sourceImageUrl)
          const { dataUrl } = await pdf.renderPage(pageIndex)
          if (!cancelled) {
            setAnnotatorSource({ url: dataUrl, floorPlanId: initial.sourceFloorPlanId, name: initial.floorPlanName, pageIndex })
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
  }, [initial])

  // ── List floor plans (images + PDFs) ──
  useEffect(() => {
    if (initial) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .schema('tenants')
        .from('floor_plans')
        .select('id, name, level, file_path')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      const rows = (data ?? []) as FloorPlan[]

      // Annotatable plans: raster/vector images AND PDFs (rasterised on pick).
      const supported = rows.filter(r => isImagePath(r.file_path) || isPdfPath(r.file_path))
      const signed = await Promise.all(
        supported.map(async r => {
          const { data: s } = await supabase.storage.from('drawings').createSignedUrl(r.file_path, 60 * 60)
          return { ...r, signedUrl: s?.signedUrl, isPdf: isPdfPath(r.file_path) }
        }),
      )
      if (!cancelled) {
        setPlans(signed)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, initial])

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
        const { dataUrl } = await pdf.renderPage(1)
        setAnnotatorSource({ url: dataUrl, floorPlanId: plan.id, name: planLabel(plan), pageIndex: 1 })
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
      const { dataUrl } = await pdfRef.current.renderPage(pageNum)
      setAnnotatorSource({ url: dataUrl, floorPlanId: picked.id, name: planLabel(picked), pageIndex: pageNum })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render PDF page')
    } finally {
      setPreparing(false)
    }
  }

  // ── Annotator (image or rasterised-PDF source) ──
  if (annotatorSource) {
    return (
      <FloorPlanAnnotator
        floorPlanName={annotatorSource.name}
        sourceImageUrl={annotatorSource.url}
        sourceFloorPlanId={annotatorSource.floorPlanId}
        initialAnnotation={initial?.annotationData}
        onCancel={() => {
          if (initial) onClose()
          else { setAnnotatorSource(null); setPicked(null); setPdfPages(null); pdfRef.current = null }
        }}
        onSave={({ blob, annotationData, previewUrl }) => {
          // For PDF sources, record the page and drop the (large) rasterised
          // image from the scene graph — re-edit re-rasterises from the source.
          const finalData: AnnotationData = annotatorSource.pageIndex
            ? { ...annotationData, sourcePageIndex: annotatorSource.pageIndex, baseImage: { ...annotationData.baseImage, signedUrl: undefined } }
            : annotationData
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          onStage({
            kind: 'annotation',
            id: Math.random().toString(36).slice(2, 10),
            blob,
            fileName: `floorplan-markup-${stamp}.png`,
            previewUrl,
            sourceFloorPlanId: annotatorSource.floorPlanId,
            annotationData: finalData,
          })
          onClose()
        }}
      />
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Attach floor plan"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 75,
        background: 'rgba(11,11,18,0.78)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '80vh', overflow: 'hidden',
          background: 'var(--c-panel)', border: '1px solid var(--c-border)',
          borderRadius: 10, display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--c-border)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>Attach floor plan</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
              {pdfPages ? `Pick a page to mark up · ${picked?.name ?? ''}` : 'Pick a plan to mark up'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)', borderRadius: 6, padding: '5px 9px',
              fontSize: 11, cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {(loading || preparing) && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              {preparing ? 'Preparing PDF…' : 'Loading floor plans…'}
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: '#fca5a5', fontSize: 12 }}>{error}</p>
          )}

          {/* Multi-page PDF — page picker */}
          {!preparing && pdfPages && pdfPages > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8 }}>
              {Array.from({ length: pdfPages }, (_, idx) => idx + 1).map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handlePagePick(n)}
                  style={{
                    background: 'var(--c-base)', border: '1px solid var(--c-border)',
                    borderRadius: 8, padding: '14px 0', cursor: 'pointer',
                    color: 'var(--c-text)', fontSize: 13, fontWeight: 600,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--c-amber)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--c-border)' }}
                >
                  Page {n}
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && !preparing && !pdfPages && !error && plans.length === 0 && (
            <div style={{
              padding: '22px 16px', textAlign: 'center',
              border: '1px dashed var(--c-border)', borderRadius: 8,
            }}>
              <Map size={24} color="var(--c-text-dim)" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                No floor plans found for this project.
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 6 }}>
                Upload a floor plan (PDF, PNG or JPG) from the project&apos;s Floor Plans page first.
              </p>
            </div>
          )}

          {/* Plan grid */}
          {!loading && !preparing && !pdfPages && plans.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {plans.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePick(p)}
                  style={{
                    background: 'var(--c-base)', border: '1px solid var(--c-border)',
                    borderRadius: 8, padding: 0, overflow: 'hidden',
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', flexDirection: 'column',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--c-amber)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--c-border)' }}
                >
                  <div style={{
                    aspectRatio: '4 / 3', background: 'var(--c-surface, #13131E)', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {p.isPdf ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--c-text-dim)' }}>
                        <FileText size={26} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em' }}>PDF</span>
                      </div>
                    ) : (
                      p.signedUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.signedUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )
                    )}
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.3 }}>
                      {p.name}
                    </div>
                    {p.level && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2, letterSpacing: '0.04em' }}>
                        {p.level}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
