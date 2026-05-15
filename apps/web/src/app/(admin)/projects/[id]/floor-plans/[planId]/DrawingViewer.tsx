'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { SceneGraph, RfiOption, ViewerMode } from './MarkupCanvas'

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

const MODES: ReadonlyArray<{ value: ViewerMode; label: string; hint: string }> = [
  { value: 'view', label: 'View', hint: 'Read-only preview — pan and zoom only' },
  { value: 'markup', label: 'Markup', hint: 'Full drawing tools; save attaches to an existing RFI' },
  { value: 'rfi', label: 'RFI', hint: 'Full drawing tools; save creates a new RFI with this markup' },
]

export function DrawingViewer({
  plan,
  projectId,
  annotations,
  snagPins,
  rfis,
  editing,
  initialMode,
}: {
  plan: DrawingPlan
  projectId: string
  annotations: AnnotationListItem[]
  snagPins: SnagPin[]
  rfis: RfiOption[]
  editing: EditingAnnotation | null
  initialMode: ViewerMode
}) {
  const router = useRouter()
  const pathname = usePathname()

  // Re-edit always lands in markup mode (the toolbar makes no sense in
  // view mode for an existing markup edit), regardless of initialMode.
  const [mode, setMode] = useState<ViewerMode>(editing ? 'markup' : initialMode)

  const onModeChange = useCallback(
    (next: ViewerMode) => {
      if (next === mode) return
      setMode(next)
      // Sync to URL so the deep-link reflects the current mode, but use
      // `replace` so back-button history isn't polluted by every flick of
      // the toggle. `scroll: false` keeps the viewport pinned.
      const qs = next === 'view' ? '' : `?mode=${next}`
      router.replace(`${pathname}${qs}`, { scroll: false })
    },
    [mode, pathname, router],
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Mode toggle — only shown when there's actually a viewer to render
            (the fallback for unsupported file types is rendered by the
            parent server page; this component is only mounted when a real
            canvas can run). Hidden in re-edit mode (single-purpose flow). */}
        {!editing && (
          <div className="data-panel" style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div
              role="tablist"
              aria-label="Drawing mode"
              style={{
                display: 'flex',
                border: '1px solid var(--c-border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {MODES.map((m) => {
                const active = mode === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onModeChange(m.value)}
                    title={m.hint}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      padding: '7px 14px',
                      background: active ? 'var(--c-amber-mid)' : 'var(--c-panel)',
                      color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--c-text-dim)',
                letterSpacing: '0.04em',
              }}
            >
              {MODES.find((m) => m.value === mode)?.hint}
            </span>
          </div>
        )}

        <MarkupCanvas
          plan={plan}
          snagPins={snagPins}
          projectId={projectId}
          rfis={rfis}
          editing={editing}
          mode={mode}
        />
      </div>
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
