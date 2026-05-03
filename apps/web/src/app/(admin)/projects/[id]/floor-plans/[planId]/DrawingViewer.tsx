'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { SceneGraph, RfiOption } from './MarkupCanvas'

const MarkupCanvas = dynamic(
  () => import('./MarkupCanvas').then((m) => m.MarkupCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 480,
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

export type DrawingPlan = {
  id: string
  name: string
  width_px: number | null
  height_px: number | null
  pixels_per_meter: number | null
  signedUrl: string | null
  isPdf: boolean
}

export type AnnotationListItem = {
  id: string
  rfi_id: string
  attachment_id: string
  created_at: string
}

export type SnagPin = {
  id: string
  title: string
  status: string
  priority: string
  floor_plan_pin: { x: number; y: number }
}

export type EditingAnnotation = {
  id: string
  rfiId: string
  scene: SceneGraph
}

export function DrawingViewer({
  plan,
  projectId,
  annotations,
  snagPins,
  rfis,
  editing,
}: {
  plan: DrawingPlan
  projectId: string
  annotations: AnnotationListItem[]
  snagPins: SnagPin[]
  rfis: RfiOption[]
  editing: EditingAnnotation | null
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16, alignItems: 'start' }}>
      <MarkupCanvas
        plan={plan}
        snagPins={snagPins}
        projectId={projectId}
        rfis={rfis}
        editing={editing}
      />
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Markups on this drawing</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {annotations.length}
            </span>
          </div>
          {annotations.length === 0 ? (
            <div className="data-panel-empty">No markups yet</div>
          ) : (
            annotations.map((a) => (
              <Link key={a.id} href={`/rfis/${a.rfi_id}?projectId=${projectId}`} className="data-panel-row" style={{ gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--c-text)' }}>RFI markup</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    {new Date(a.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="badge badge-amber">view</span>
              </Link>
            ))
          )}
        </div>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Snag pins</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {snagPins.length}
            </span>
          </div>
          {snagPins.length === 0 ? (
            <div className="data-panel-empty">No snag pins on this plan</div>
          ) : (
            snagPins.map((s) => (
              <Link key={s.id} href={`/snags/${s.id}`} className="data-panel-row" style={{ gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    {s.priority} · {s.status.replace(/_/g, ' ')}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
