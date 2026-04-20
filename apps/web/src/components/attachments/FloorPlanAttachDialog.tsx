'use client'

import { useEffect, useState } from 'react'
import { X, Map } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
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

export function FloorPlanAttachDialog({ projectId, onClose, onStage, initial }: Props) {
  const [plans, setPlans] = useState<FloorPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FloorPlan | null>(null)
  const [annotatorOpen, setAnnotatorOpen] = useState(!!initial)

  // If we're re-editing, synth a "picked" plan so the annotator has its source URL.
  const editingPlan: FloorPlan | null = initial
    ? {
        id: initial.sourceFloorPlanId ?? 'source-deleted',
        name: initial.floorPlanName,
        level: null,
        file_path: '',
        signedUrl: initial.sourceImageUrl,
      }
    : null

  useEffect(() => {
    if (initial) return // skip list fetch when re-editing
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

      // Only images can be annotated on a canvas. Filter non-image plans
      // (PDFs / DWGs) out of the picker for v1.
      const imageRows = rows.filter(r => /\.(png|jpe?g|webp|heic)$/i.test(r.file_path))

      const signed = await Promise.all(
        imageRows.map(async r => {
          const { data: s } = await supabase.storage.from('drawings').createSignedUrl(r.file_path, 60 * 60)
          return { ...r, signedUrl: s?.signedUrl }
        }),
      )
      if (!cancelled) {
        setPlans(signed)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, initial])

  function handlePick(plan: FloorPlan) {
    setPicked(plan)
    setAnnotatorOpen(true)
  }

  const activeSource = editingPlan ?? picked

  if (annotatorOpen && activeSource?.signedUrl) {
    return (
      <FloorPlanAnnotator
        floorPlanName={`${activeSource.name}${activeSource.level ? ` · ${activeSource.level}` : ''}`}
        sourceImageUrl={activeSource.signedUrl}
        sourceFloorPlanId={activeSource.id === 'source-deleted' ? null : activeSource.id}
        initialAnnotation={initial?.annotationData}
        onCancel={() => {
          if (initial) onClose()
          else { setAnnotatorOpen(false); setPicked(null) }
        }}
        onSave={({ blob, annotationData, previewUrl }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const fileName = `floorplan-markup-${stamp}.png`
          onStage({
            kind: 'annotation',
            id: Math.random().toString(36).slice(2, 10),
            blob,
            fileName,
            previewUrl,
            sourceFloorPlanId: activeSource.id === 'source-deleted' ? null : activeSource.id,
            annotationData,
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
              Pick a plan to mark up
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
          {loading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              Loading floor plans…
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: '#fca5a5', fontSize: 12 }}>{error}</p>
          )}
          {!loading && !error && plans.length === 0 && (
            <div style={{
              padding: '22px 16px', textAlign: 'center',
              border: '1px dashed var(--c-border)', borderRadius: 8,
            }}>
              <Map size={24} color="var(--c-text-dim)" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                No image floor plans found for this project.
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 6 }}>
                Upload a PNG or JPG floor plan from the project page first.
              </p>
            </div>
          )}
          {!loading && plans.length > 0 && (
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
                  <div style={{ aspectRatio: '4 / 3', background: 'var(--c-surface, #13131E)', overflow: 'hidden' }}>
                    {p.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.signedUrl}
                        alt={p.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
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
