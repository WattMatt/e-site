'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { SceneGraph, RfiOption, ViewerMode } from './MarkupCanvas'
import type { OtherLeg } from './RouteLayer'
import { buildViewerQuery, saveTargetFor, adoptSavedLayer, type ActiveLayer } from './viewer-state'
import {
  saveFloorPlanMarkupAction,
  renameFloorPlanMarkupAction,
  deleteFloorPlanMarkupAction,
  type SavedMarkup,
} from '@/actions/floor-plan-markup.actions'

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
  /** Where the scale was taken (00198), so the sheet can show it. */
  calibration_points: number[] | null
  calibration_metres: number | null
  calibration_page_index: number | null
  /** Scale per PDF page (00199). */
  page_scales?: Array<{ pageIndex: number; pixelsPerMeter: number; points: number[] | null; metres: number | null }>
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
  { value: 'markup', label: 'Markup', hint: 'Full drawing tools; save a named markup on this drawing, or attach one to an RFI' },
  { value: 'rfi', label: 'RFI', hint: 'Full drawing tools; save creates a new RFI with this markup' },
]

const railBtn: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '4px 8px',
  background: 'var(--c-panel)',
  color: 'var(--c-text-mid)',
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  cursor: 'pointer',
}

export function DrawingViewer({
  plan,
  projectId,
  annotations,
  snagPins,
  rfis,
  editing,
  initialMode,
  canWrite,
  markups,
  openMarkup,
  measureHrefBase = null,
  sheetLegs = [],
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
  /** Saved markup layers on this drawing (00205). */
  markups: SavedMarkup[]
  /** The layer opened via `?markup=<id>`, hydrated onto the canvas. */
  openMarkup: SavedMarkup | null
  /**
   * Where a pressed route goes: the cable schedule's measure page with this
   * sheet open (`…/measure?sheet=<id>`); the run is appended on press. A
   * string because it crosses the server → client boundary. Supplied only
   * when the caller may measure (ORG_WRITE_ROLES) and the project has a DRAFT
   * revision; null means routes are drawn but not pressable. Tracing itself
   * lives on that page, not on this viewer.
   */
  measureHrefBase?: string | null
  /** Every saved route leg on this sheet, for the overlay in any mode. */
  sheetLegs?: OtherLeg[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  /** Saved-markup rail state: which row is armed for delete, and rename. */
  const [armedDeleteMarkupId, setArmedDeleteMarkupId] = useState<string | null>(null)
  const [renamingMarkupId, setRenamingMarkupId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [markupError, setMarkupError] = useState<string | null>(null)
  useEffect(() => {
    if (!armedDeleteMarkupId) return
    const t = setTimeout(() => setArmedDeleteMarkupId(null), 4000)
    return () => clearTimeout(t)
  }, [armedDeleteMarkupId])

  /**
   * The layer this session is writing to. Seeded from `?markup=` when one was
   * REOPENED, and — the part that was missing — ADOPTED from the row the first
   * save returns, so the second save updates instead of inserting again.
   *
   * Why this is local state and not the URL: the canvas is keyed on
   * `openMarkup?.id`, so pushing `markup=<new id>` after a create would remount
   * it, and a remount re-runs the image effect and re-rasterises the sheet —
   * 20-60s on an A1. The URL stays the "which layer did I deliberately open"
   * signal; this is "which layer am I writing to now".
   */
  const [activeLayer, setActiveLayer] = useState<ActiveLayer | null>(
    openMarkup ? { id: openMarkup.id, name: openMarkup.name, updatedAt: openMarkup.updatedAt } : null,
  )
  useEffect(() => {
    setActiveLayer(openMarkup ? { id: openMarkup.id, name: openMarkup.name, updatedAt: openMarkup.updatedAt } : null)
  }, [openMarkup])

  /**
   * Save the canvas as a named layer.
   *
   * ⚠ The concurrency token and the id BOTH have to come from the last save,
   * not from the page load. Before this, `markupId` read `openMarkup?.id` —
   * null for a layer created in this session — so pressing Save twice INSERTed
   * twice and the second one hit the (floor_plan_id, name) unique constraint.
   * The user was told to pick another name when they only wanted to save again.
   */
  const onSaveLayer = useCallback(
    async (scene: SceneGraph, name: string) => {
      const res = await saveFloorPlanMarkupAction({
        floorPlanId: plan.id,
        name,
        scene,
        ...saveTargetFor(activeLayer),
      })
      if (res.error) return { error: res.error }
      // Adopt the saved row: its id makes the next save an UPDATE, and its
      // updated_at is the token that next save must present.
      setActiveLayer((prev) => adoptSavedLayer(prev, res.markup))
      router.refresh()
      return {}
    },
    [plan.id, activeLayer, router],
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
      // ⚠ Rebuild the querystring, do NOT replace it. This previously emitted
      // a bare `?mode=<next>`, which dropped `markup=` — so pressing the RFI
      // tab with a saved layer open blanked the canvas (the canvas is keyed on
      // the open layer, so it remounted with no scene) and then greyed both
      // RFI buttons on `shapes.length === 0`. The user's markup looked lost.
      // Carrying the layer through is also what makes "open a layer, then
      // attach it to an RFI" possible at all.
      router.replace(`${pathname}${buildViewerQuery(next, openMarkup?.id ?? null)}`, { scroll: false })
    },
    [canWrite, mode, pathname, router, openMarkup],
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
        {openMarkup?.staleAgainstDrawing && (
          <div
            className="data-panel"
            role="alert"
            style={{ padding: '10px 12px', marginBottom: 8, fontSize: 12, borderColor: 'var(--c-amber)' }}
          >
            <strong>&ldquo;{openMarkup.name}&rdquo; was drawn on an earlier version of this drawing.</strong>{' '}
            The drawing file has been updated since, so these marks may no longer sit where they were put.
            Check them against the sheet before relying on them. Nothing has been moved: the marks are exactly
            as they were saved, and there is no way to translate them onto a different revision automatically.
          </div>
        )}
        {canWrite && !editing && (
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
          // Remount when a different saved layer is opened: `initialScene`
          // seeds `shapes` as INITIAL state only, so without this, opening a
          // second layer would leave the first one's shapes on the canvas.
          key={`${plan.id}:${openMarkup?.id ?? 'new'}`}
          initialScene={openMarkup?.scene as SceneGraph | undefined}
          saveLayer={
            canWrite && !editing
              ? { openName: activeLayer?.name ?? null, onSave: onSaveLayer }
              : undefined
          }
          routeOverlay={{
            legs: sheetLegs,
            // Pressing a route opens it on the measure page — the same gate
            // that page applies decides whether the press does anything.
            onMeasure: measureHrefBase ? (supplyId: string) => router.push(`${measureHrefBase}&supply=${supplyId}`) : undefined,
          }}
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
            <span className="data-panel-title">Saved markups</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {markups.length}
            </span>
          </div>
          {markupError && (
            <div role="alert" style={{ padding: '6px 10px', fontSize: 12, color: '#dc2626' }}>{markupError}</div>
          )}
          {markups.length === 0 ? (
            <div className="data-panel-empty">
              {canWrite
                ? 'None yet. Draw on the sheet, then press Save markup.'
                : 'No saved markups on this drawing.'}
            </div>
          ) : (
            markups.map((mk) => {
              const isOpen = openMarkup?.id === mk.id
              return (
                <div key={mk.id} className="data-panel-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {renamingMarkupId === mk.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        maxLength={80}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Escape') { setRenamingMarkupId(null); return }
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          const res = await renameFloorPlanMarkupAction({ markupId: mk.id, name: renameValue })
                          if (res.error) { setMarkupError(res.error); return }
                          setMarkupError(null)
                          setRenamingMarkupId(null)
                          router.refresh()
                        }}
                        style={{
                          flex: 1, minWidth: 120, fontSize: 12, padding: '4px 6px',
                          background: 'var(--c-base)', color: 'var(--c-text)',
                          border: '1px solid var(--c-amber)', borderRadius: 4,
                        }}
                      />
                      <button type="button" onClick={() => setRenamingMarkupId(null)} style={railBtn}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => router.push(`${pathname}?mode=markup&markup=${mk.id}`)}
                        style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        title={isOpen ? 'This markup is open' : 'Open this markup on the drawing'}
                      >
                        <div style={{ fontSize: 12, color: isOpen ? 'var(--c-amber)' : 'var(--c-text)' }}>
                          {mk.name}{isOpen ? ' · open' : ''}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                          {mk.shapeCount} item{mk.shapeCount === 1 ? '' : 's'} · {new Date(mk.updatedAt).toLocaleDateString()}
                        </div>
                      </button>
                      {mk.staleAgainstDrawing && (
                        <span className="badge badge-warning" title="Drawn on an earlier version of this drawing">older file</span>
                      )}
                      {canWrite && (
                        <>
                          <button
                            type="button"
                            style={railBtn}
                            onClick={() => { setRenamingMarkupId(mk.id); setRenameValue(mk.name) }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            style={armedDeleteMarkupId === mk.id ? { ...railBtn, background: 'var(--c-amber)', color: '#1a1a1a', borderColor: 'var(--c-amber)' } : railBtn}
                            title={armedDeleteMarkupId === mk.id ? 'Press again to delete' : 'Delete this markup — press twice'}
                            onClick={async () => {
                              if (armedDeleteMarkupId !== mk.id) { setArmedDeleteMarkupId(mk.id); return }
                              setArmedDeleteMarkupId(null)
                              const res = await deleteFloorPlanMarkupAction({ markupId: mk.id })
                              if (res.error) { setMarkupError(res.error); return }
                              setMarkupError(null)
                              if (isOpen) router.push(`${pathname}?mode=markup`)
                              else router.refresh()
                            }}
                          >
                            {armedDeleteMarkupId === mk.id ? 'Confirm' : 'Delete'}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">RFI markups</span>
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

