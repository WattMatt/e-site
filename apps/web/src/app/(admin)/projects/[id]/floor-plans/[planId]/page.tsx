import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService, rfiService } from '@esite/shared'
import { DrawingViewer, type EditingAnnotation } from './DrawingViewer'
import type { ViewerMode } from './MarkupCanvas'

interface Props {
  params: Promise<{ id: string; planId: string }>
  searchParams: Promise<{ annotation?: string; mode?: string }>
}

type AnnotationRow = {
  id: string
  rfi_id: string
  attachment_id: string
  created_at: string
}

// Whitelist for the ?mode= querystring. Anything else (including absent)
// falls back to 'view' so a stale or hand-typed URL doesn't 404.
const VALID_MODES: ReadonlyArray<ViewerMode> = ['view', 'markup', 'rfi']
function parseMode(raw: string | undefined): ViewerMode {
  return (VALID_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as ViewerMode)
    : 'view'
}

export default async function DrawingViewerPage({ params, searchParams }: Props) {
  const { id: projectId, planId } = await params
  const { annotation: editingId, mode: rawMode } = await searchParams
  const initialMode = parseMode(rawMode)
  const supabase = await createClient()

  const [project, planRaw, rfisRaw] = await Promise.all([
    projectService.getById(supabase as any, projectId).catch(() => null),
    floorPlanService.getById(supabase as any, planId).catch(() => null),
    rfiService.list(supabase as any, projectId).catch(() => []),
  ])
  if (!project || !planRaw || planRaw.project_id !== projectId) notFound()
  // Calibration columns are added in migration 00035; types will widen once
  // db types are regenerated. Until then, cast for the new fields.
  const plan = planRaw as typeof planRaw & {
    pixels_per_meter: number | null
    calibrated_at: string | null
    calibrated_by: string | null
  }

  // RFIs eligible for attachment: not closed.
  const rfis = (rfisRaw as Array<{ id: string; subject: string; status: string }>)
    .filter((r) => r.status !== 'closed')
    .map((r) => ({ id: r.id, subject: r.subject, status: r.status }))

  // Re-edit mode: hydrate from the existing annotation if `?annotation=` is set.
  let editing: EditingAnnotation | null = null
  if (editingId) {
    const { data: existing } = await (supabase as any)
      .from('rfi_annotations')
      .select('id, rfi_id, annotation_data, source_floor_plan_id')
      .eq('id', editingId)
      .single()
    if (existing && existing.source_floor_plan_id === planId) {
      editing = {
        id: existing.id,
        rfiId: existing.rfi_id,
        scene: existing.annotation_data,
      }
    }
  }

  const isPdf = /\.pdf$/i.test(plan.file_path)
  const isImage = /\.(png|jpe?g|webp|svg)$/i.test(plan.file_path)
  let signedUrl: string | null = null
  if (isPdf || isImage) {
    const { data } = await supabase.storage
      .from('drawings')
      .createSignedUrl(plan.file_path, 3600)
    signedUrl = data?.signedUrl ?? null
  }

  // Existing markups attached to this drawing (right rail).
  // `rfi_annotations` table types live behind `as any` until db types
  // regenerate post-migration 00033/00035.
  const { data: annotationsData } = await (supabase as any)
    .from('rfi_annotations')
    .select('id, rfi_id, attachment_id, created_at')
    .eq('source_floor_plan_id', planId)
    .order('created_at', { ascending: false })
  const annotations: AnnotationRow[] = (annotationsData ?? []) as AnnotationRow[]

  // Snag pins on this drawing (read-only overlay)
  const snagPins = await floorPlanService
    .getSnagPins(supabase as any, planId)
    .catch(() => [])

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/floor-plans`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Floor Plans
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{plan.name}</h1>
          <p className="page-subtitle">
            {project.name}
            {plan.level ? ` · ${plan.level}` : ''}
            {plan.scale ? ` · Scale ${plan.scale}` : ''}
            {plan.pixels_per_meter
              ? ` · Calibrated (${plan.pixels_per_meter.toFixed(1)} px/m)`
              : ' · Uncalibrated'}
          </p>
        </div>
      </div>

      {!isPdf && !isImage ? (
        // Non-PDF/image (e.g. DWG/DXF) — the markup canvas can't render it.
        // Show a fallback panel and offer the original download via the
        // existing /floor-plans list page (Download button there forces an
        // attachment Content-Disposition).
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }} aria-hidden="true">📄</div>
            <div style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 6 }}>
              Preview not supported for this file type yet.
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              In-browser preview is currently available for PDF, PNG, JPG, WebP and SVG.
            </div>
            <Link
              href={`/projects/${projectId}/floor-plans`}
              className="btn-primary-amber"
              style={{ display: 'inline-block', marginTop: 18, textDecoration: 'none' }}
            >
              Back to drawings list to download original
            </Link>
          </div>
        </div>
      ) : (
      <DrawingViewer
        plan={{
          id: plan.id,
          name: plan.name,
          width_px: plan.width_px,
          height_px: plan.height_px,
          pixels_per_meter: plan.pixels_per_meter ?? null,
          signedUrl,
          isPdf,
        }}
        projectId={projectId}
        annotations={annotations}
        snagPins={snagPins as Array<{ id: string; title: string; status: string; priority: string; floor_plan_pin: { x: number; y: number } }>}
        rfis={rfis}
        editing={editing}
        initialMode={initialMode}
      />
      )}
    </div>
  )
}
