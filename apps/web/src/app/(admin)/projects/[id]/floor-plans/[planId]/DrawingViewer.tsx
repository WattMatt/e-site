'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { SceneGraph, RfiOption, ViewerMode } from './MarkupCanvas'
import { saveSupplyRouteAction } from '@/actions/cable-route.actions'

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

/**
 * Everything route mode needs to append a leg without losing what is already
 * traced. `saveSupplyRouteAction` REPLACES the whole segment list, so appending
 * means resending the others — and resending them means carrying rise/drop
 * through untouched, or the save would silently reset them to 0.
 */
export type RouteContext = {
  supplyId: string
  runLabel: string
  riseM: number
  dropM: number
  /** Back to the measure worklist. */
  doneHref: string
  segments: Array<{
    id: string
    /** NULL when the drawing was deleted or de-activated after tracing. */
    floorPlanId: string | null
    floorPlanName: string
    pageIndex: number
    points: number[]
    lengthM: number
  }>
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
  canWrite,
  route,
}: {
  plan: DrawingPlan
  projectId: string
  annotations: AnnotationListItem[]
  snagPins: SnagPin[]
  rfis: RfiOption[]
  editing: EditingAnnotation | null
  initialMode: ViewerMode
  /** Effective project role allows creating/editing markup. When false the
   *  viewer is pinned to read-only 'view' and the mode toggle is hidden. */
  canWrite: boolean
  /** Present only when the page was opened as `?mode=route&supply=…`. */
  route?: RouteContext
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [routeError, setRouteError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)

  /**
   * Append one traced leg to this run's route.
   *
   * ⚠ The save action replaces the entire segment list, so a segment whose
   * drawing has since been deleted (`floor_plan_id` is ON DELETE SET NULL)
   * cannot be resent — the schema requires a uuid. Appending in that state
   * would silently drop a leg and shorten the run. Refuse instead, and say so.
   */
  const onCommitLeg = useCallback(
    async ({ points, pageIndex }: { points: number[]; pageIndex: number }) => {
      if (!route) return {}
      const orphaned = route.segments.filter((g) => !g.floorPlanId)
      if (orphaned.length > 0) {
        const msg = `This run has ${orphaned.length} leg${orphaned.length === 1 ? '' : 's'} traced on a drawing that is no longer available, so it cannot be added to safely. Re-measure the run from the worklist.`
        setRouteError(msg)
        return { error: msg }
      }
      setCommitting(true)
      setRouteError(null)
      try {
        const res = await saveSupplyRouteAction({
          supplyId: route.supplyId,
          riseM: route.riseM,
          dropM: route.dropM,
          segments: [
            ...route.segments.map((g) => ({
              floorPlanId: g.floorPlanId as string,
              pageIndex: g.pageIndex,
              points: g.points,
            })),
            { floorPlanId: plan.id, pageIndex, points },
          ],
        })
        if (res.error) {
          setRouteError(res.error)
          return { error: res.error }
        }
        router.refresh()
        return {}
      } finally {
        setCommitting(false)
      }
    },
    [route, plan.id, router],
  )

  // Re-edit always lands in markup mode (the toolbar makes no sense in
  // view mode for an existing markup edit), regardless of initialMode.
  // Read-only roles are pinned to 'view' whatever the URL/props say.
  const [mode, setMode] = useState<ViewerMode>(
    !canWrite ? 'view' : editing ? 'markup' : initialMode,
  )

  const onModeChange = useCallback(
    (next: ViewerMode) => {
      if (!canWrite) return // read-only: mode is fixed at 'view'
      if (next === mode) return
      setMode(next)
      // Sync to URL so the deep-link reflects the current mode, but use
      // `replace` so back-button history isn't polluted by every flick of
      // the toggle. `scroll: false` keeps the viewport pinned.
      const qs = next === 'view' ? '' : `?mode=${next}`
      router.replace(`${pathname}${qs}`, { scroll: false })
    },
    [canWrite, mode, pathname, router],
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Mode toggle — only shown when there's actually a viewer to render
            (the fallback for unsupported file types is rendered by the
            parent server page; this component is only mounted when a real
            canvas can run). Hidden in re-edit mode (single-purpose flow), and
            hidden entirely for read-only roles (they only get 'view'). */}
        {!canWrite && (
          <div
            className="data-panel"
            style={{
              padding: '8px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
            }}
          >
            Read-only — pan and zoom only. Markup requires write access.
          </div>
        )}
        {routeError && (
          <div
            className="data-panel"
            style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger, #b4413c)', borderColor: 'var(--c-danger, #b4413c)' }}
            role="alert"
          >
            {routeError}
          </div>
        )}
        {canWrite && !editing && !route && (
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
          mode={route ? 'route' : mode}
          routeMode={
            route
              ? {
                  runLabel: route.runLabel,
                  savedLegs: route.segments.map((g) => ({
                    id: g.id,
                    floorPlanName: g.floorPlanName,
                    pageIndex: g.pageIndex,
                    lengthM: g.lengthM,
                  })),
                  onCommitLeg,
                  doneHref: route.doneHref,
                }
              : undefined
          }
        />
      </div>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {route ? (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Legs traced</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                {committing ? 'saving…' : route.segments.length}
              </span>
            </div>
            {route.segments.length === 0 ? (
              <div className="data-panel-empty">
                Nothing traced yet. Pick the polyline tool and click along the route.
              </div>
            ) : (
              route.segments.map((g, i) => (
                <div key={g.id} className="data-panel-row" style={{ gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i + 1}. {g.floorPlanName}
                      {!g.floorPlanId && ' (drawing removed)'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      page {g.pageIndex}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)' }}>
                    {g.lengthM.toFixed(2)} m
                  </span>
                </div>
              ))
            )}
            <div
              className="data-panel-row"
              style={{ gap: 10, borderTop: '1px solid var(--c-border)', fontWeight: 700 }}
            >
              <div style={{ flex: 1, fontSize: 12 }}>Traced</div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {route.segments.reduce((n, g) => n + g.lengthM, 0).toFixed(2)} m
              </span>
            </div>
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--c-text-dim)', lineHeight: 1.5 }}>
              Rise and drop are added back in the worklist, where the total is assigned to the
              schedule. Tracing a route never changes a cable length on its own.
            </div>
          </div>
        ) : (
        <>
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
        </>
        )}
      </aside>
    </div>
  )
}
