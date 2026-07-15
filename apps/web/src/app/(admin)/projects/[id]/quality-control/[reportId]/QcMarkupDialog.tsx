'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { X, Map } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { replaceQcMarkup } from '@/lib/qc-photos'
import type { SceneGraph } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas'

// Host the full MarkupCanvas (react-konva + pdfjs) client-only, mirroring
// DrawingViewer's dynamic import — it must not run through SSR.
const MarkupCanvas = dynamic(
  () => import('@/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas').then((m) => m.MarkupCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: '70vh',
          background: 'var(--c-base)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--c-text-dim)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        Loading canvas…
      </div>
    ),
  },
)

// ─── Staged markup (add flow) ────────────────────────────────────────────────
// Carries the flattened PNG + the full editable SceneGraph. The entry form
// holds these until submit, then uploadQcMarkup persists `scene` as
// annotation_data (upload deferred so a mid-submit failure is resumable).
export interface StagedQcMarkup {
  id: string
  blob: Blob
  scene: SceneGraph
  sourceFloorPlanId: string | null
  fileName: string
  /** Object URL for the staging thumbnail (revoked by the form on removal). */
  previewUrl: string
}

// ─── Internal plan shapes ────────────────────────────────────────────────────
interface PickerPlan {
  id: string
  name: string
  level: string | null
  file_path: string
  width_px: number | null
  height_px: number | null
  pixels_per_meter: number | null
  signedUrl: string | null
  isPdf: boolean
  /** PDF or raster → the canvas can render it; DWG/DXF/etc. → shown disabled. */
  markable: boolean
}

interface CanvasPlan {
  /** MarkupCanvas plan.id — the calibration target. 'source-deleted' when gone. */
  id: string
  title: string
  signedUrl: string | null
  width_px: number | null
  height_px: number | null
  pixels_per_meter: number | null
  isPdf: boolean
  /** Persisted with the markup for re-signing on re-edit; null when deleted. */
  sourceFloorPlanId: string | null
}

interface ReEditTarget {
  photoId: string
  filePath: string
  sourceFloorPlanId: string | null
  initialScene: SceneGraph
  planName: string
}

interface Props {
  projectId: string
  onClose: () => void
  /** Add flow: hand the staged markup up to the entry form. */
  onStaged?: (staged: StagedQcMarkup) => void
  /** Re-edit flow: skip the picker, hydrate the stored scene, replace in place. */
  reEdit?: ReEditTarget
}

const isPdfPath = (p: string) => /\.pdf$/i.test(p)
const isImagePath = (p: string) => /\.(png|jpe?g|webp|svg)$/i.test(p)
const makeId = () => Math.random().toString(36).slice(2, 10)

/**
 * QC drawing-markup dialog — the full MarkupCanvas suite inline in the QC entry
 * flow (spec §Approach.2). Two-step in the add flow: a drawing picker (every
 * active floor plan, PDFs included — no extension filter) then the canvas. The
 * re-edit flow jumps straight to the canvas, re-signing the source plan.
 *
 * The RFI markup path (FloorPlanAnnotator / FloorPlanAttachDialog) is left
 * untouched — this is a parallel host that drives MarkupCanvas in its
 * external-save mode (`onSaveMarkup`), so no RFI is ever created or attached.
 */
export function QcMarkupDialog({ projectId, onClose, onStaged, reEdit }: Props) {
  const router = useRouter()
  const isReEdit = !!reEdit

  // ── Picker (add flow) ──────────────────────────────────────────────────
  const [plans, setPlans] = useState<PickerPlan[]>([])
  const [loading, setLoading] = useState(!isReEdit)
  const [error, setError] = useState<string | null>(null)
  const [pickedPlan, setPickedPlan] = useState<CanvasPlan | null>(null)

  // ── Canvas plan for the re-edit flow (re-signed source) ────────────────
  const [reEditPlan, setReEditPlan] = useState<CanvasPlan | null>(null)
  const [reEditLoading, setReEditLoading] = useState(isReEdit)

  // Load the project's active floor plans — NO extension filter (this is the
  // "access the full drawing list" fix). PDFs and rasters are markable; DWG/DXF
  // are listed but disabled. Mirrors [planId]/page.tsx's isPdf/isImage split.
  useEffect(() => {
    if (isReEdit) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      // `pixels_per_meter` (migration 00035) isn't in the generated types yet —
      // cast the query, matching the QC/[planId] read pattern.
      const { data, error: qErr } = await (supabase as any)
        .schema('tenants')
        .from('floor_plans')
        .select('id, name, level, file_path, width_px, height_px, pixels_per_meter')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (qErr) {
        setError(qErr.message)
        setLoading(false)
        return
      }
      const rows = (data ?? []) as Array<{
        id: string
        name: string
        level: string | null
        file_path: string
        width_px: number | null
        height_px: number | null
        pixels_per_meter: number | null
      }>
      const withMeta = await Promise.all(
        rows.map(async (r) => {
          const isPdf = isPdfPath(r.file_path)
          const markable = isPdf || isImagePath(r.file_path)
          let signedUrl: string | null = null
          if (markable) {
            const { data: s } = await supabase.storage.from('drawings').createSignedUrl(r.file_path, 60 * 60)
            signedUrl = s?.signedUrl ?? null
          }
          return { ...r, isPdf, markable, signedUrl } as PickerPlan
        }),
      )
      if (!cancelled) {
        setPlans(withMeta)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, isReEdit])

  // Re-edit: re-sign the source plan so the canvas can render it. If the plan
  // has been deleted, fall back to a blank canvas at the scene's stored dims
  // (spec §3) — the vectors still open for editing.
  useEffect(() => {
    if (!reEdit) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      let plan: CanvasPlan = {
        id: reEdit.sourceFloorPlanId ?? 'source-deleted',
        title: reEdit.planName,
        signedUrl: null,
        width_px: reEdit.initialScene.canvas?.w ?? null,
        height_px: reEdit.initialScene.canvas?.h ?? null,
        pixels_per_meter: null,
        isPdf: false,
        sourceFloorPlanId: reEdit.sourceFloorPlanId,
      }
      if (reEdit.sourceFloorPlanId) {
        const { data: row } = await (supabase as any)
          .schema('tenants')
          .from('floor_plans')
          .select('id, name, level, file_path, width_px, height_px, pixels_per_meter')
          .eq('id', reEdit.sourceFloorPlanId)
          .single()
        if (row) {
          const isPdf = isPdfPath(row.file_path)
          const markable = isPdf || isImagePath(row.file_path)
          let signedUrl: string | null = null
          if (markable) {
            const { data: s } = await supabase.storage.from('drawings').createSignedUrl(row.file_path, 60 * 60)
            signedUrl = s?.signedUrl ?? null
          }
          plan = {
            id: row.id,
            title: `${row.name}${row.level ? ` · ${row.level}` : ''}`,
            signedUrl,
            width_px: row.width_px,
            height_px: row.height_px,
            pixels_per_meter: row.pixels_per_meter,
            isPdf,
            sourceFloorPlanId: row.id,
          }
        }
      }
      if (!cancelled) {
        setReEditPlan(plan)
        setReEditLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Primitive deps keep this to a single run per re-edit target; the object
    // literal identity from the parent would otherwise re-fire it every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reEdit?.photoId, reEdit?.sourceFloorPlanId])

  function handlePick(p: PickerPlan) {
    setPickedPlan({
      id: p.id,
      title: `${p.name}${p.level ? ` · ${p.level}` : ''}`,
      signedUrl: p.signedUrl,
      width_px: p.width_px,
      height_px: p.height_px,
      pixels_per_meter: p.pixels_per_meter,
      isPdf: p.isPdf,
      sourceFloorPlanId: p.id,
    })
  }

  // MarkupCanvas external-save handler. Re-edit replaces the row in place;
  // add stages the markup for the entry form to upload on submit. Throwing
  // keeps the dialog open with MarkupCanvas's own error surfaced.
  async function handleSaveMarkup({ pngBlob, scene }: { pngBlob: Blob; scene: SceneGraph }) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `floorplan-markup-${stamp}.png`

    if (reEdit) {
      const supabase = createClient()
      await replaceQcMarkup(
        supabase as any,
        { id: reEdit.photoId, filePath: reEdit.filePath },
        { blob: pngBlob, annotationData: scene },
      )
      // Re-render the server page: freshly signed URLs bust the stale thumbnail.
      router.refresh()
      onClose()
      return
    }

    const source = pickedPlan
    onStaged?.({
      id: makeId(),
      blob: pngBlob,
      scene,
      sourceFloorPlanId: source?.sourceFloorPlanId ?? null,
      fileName,
      previewUrl: URL.createObjectURL(pngBlob),
    })
    onClose()
  }

  const activePlan = isReEdit ? reEditPlan : pickedPlan
  const canvasLoading = isReEdit ? reEditLoading : false
  const showCanvas = isReEdit || !!pickedPlan

  // ── Canvas step ────────────────────────────────────────────────────────
  if (showCanvas) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mark up drawing"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 75,
          background: 'rgba(11,11,18,0.88)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
              {isReEdit ? 'Edit markup' : 'Mark up drawing'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
              {activePlan?.title ?? 'Loading…'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              borderRadius: 6,
              padding: '5px 9px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <X size={13} /> Close
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {canvasLoading || !activePlan ? (
            <div
              style={{
                height: '70vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--c-text-dim)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            >
              Loading drawing…
            </div>
          ) : (
            <MarkupCanvas
              plan={{
                id: activePlan.id,
                signedUrl: activePlan.signedUrl,
                width_px: activePlan.width_px,
                height_px: activePlan.height_px,
                pixels_per_meter: activePlan.pixels_per_meter,
                isPdf: activePlan.isPdf,
              }}
              projectId={projectId}
              snagPins={[]}
              mode="markup"
              onSaveMarkup={handleSaveMarkup}
              initialScene={reEdit?.initialScene}
            />
          )}
        </div>
      </div>
    )
  }

  // ── Picker step (add flow) ─────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a drawing to mark up"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        background: 'rgba(11,11,18,0.78)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '80vh',
          overflow: 'hidden',
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--c-border)',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>Mark up a drawing</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
              Pick a plan to mark up
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              borderRadius: 6,
              padding: '5px 9px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {loading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              Loading floor plans…
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>
              {error}
            </p>
          )}
          {!loading && !error && plans.length === 0 && (
            <div style={{ padding: '22px 16px', textAlign: 'center', border: '1px dashed var(--c-border)', borderRadius: 8 }}>
              <Map size={24} color="var(--c-text-dim)" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>No floor plans found for this project.</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 6 }}>
                Upload a drawing from the project page first.
              </p>
            </div>
          )}
          {!loading && plans.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.markable}
                  onClick={() => p.markable && handlePick(p)}
                  title={p.markable ? undefined : 'DWG/DXF preview is not supported — convert to PDF or an image to mark it up.'}
                  style={{
                    background: 'var(--c-base)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 8,
                    padding: 0,
                    overflow: 'hidden',
                    cursor: p.markable ? 'pointer' : 'not-allowed',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    opacity: p.markable ? 1 : 0.55,
                  }}
                  onMouseEnter={(e) => {
                    if (p.markable) e.currentTarget.style.borderColor = 'var(--c-amber)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--c-border)'
                  }}
                >
                  <div
                    style={{
                      aspectRatio: '4 / 3',
                      background: 'var(--c-surface, #13131E)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {p.isPdf ? (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--c-text-dim)' }} aria-hidden="true">
                        📄
                      </span>
                    ) : p.markable && p.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.signedUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--c-text-dim)' }} aria-hidden="true">
                        📐
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.3 }}>{p.name}</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--c-text-dim)',
                        marginTop: 2,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {p.markable ? p.level ?? (p.isPdf ? 'PDF' : 'Drawing') : 'Not markable'}
                    </div>
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
