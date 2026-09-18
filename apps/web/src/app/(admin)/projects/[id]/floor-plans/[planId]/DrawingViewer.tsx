'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState, useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { SceneGraph, RfiOption, ViewerMode, CableRunOption } from './MarkupCanvas'
import type { OtherLeg } from './RouteLayer'
import { isSegmentCalibrationStale } from '@esite/shared'
import {
  saveSupplyRouteAction,
  exportRouteSheetAction,
  listRouteHistoryAction,
  restoreRouteHistoryAction,
  remeasureRouteLegsAction,
  type RouteHistoryEntry,
} from '@/actions/cable-route.actions'
import { AssignRoutePanel } from '@/components/cable-route/AssignRoutePanel'

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

/**
 * Everything route mode needs to append a leg without losing what is already
 * traced. `saveSupplyRouteAction` REPLACES the whole segment list, so appending
 * means resending the others — and resending them means carrying rise/drop
 * through untouched, or the save would silently reset them to 0.
 */
/**
 * The project's draft cable schedule, for the in-drawing ⚡ tool. Present only
 * when the caller holds ORG_WRITE_ROLES and a DRAFT revision exists.
 */
export type CableScheduleContext = {
  revisionId: string
  revisionCode: string
  runs: CableRunOption[]
}

export type RouteContext = {
  supplyId: string
  revisionId: string
  runLabel: string
  riseM: number
  dropM: number
  /** What the schedule holds for this run now (any strand), and how many strands. */
  scheduleLengthM: number | null
  strands: number
  /** The route's updated_at as loaded — the concurrency token for saves. */
  updatedAt: string | null
  /** Every drawing on the project, for continuing a run on another sheet. */
  sheets: Array<{ id: string; name: string; calibrated: boolean }>
  /** Back to the measure worklist. */
  doneHref: string
  segments: Array<{
    id: string
    /** NULL when the drawing was deleted or de-activated after tracing. */
    floorPlanId: string | null
    floorPlanName: string
    pageIndex: number
    points: number[]
    pixelsPerMeter: number
    lengthM: number
  }>
  /** Other runs' legs on THIS sheet, for context while tracing. */
  otherLegsOnSheet: OtherLeg[]
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
  cableSchedule,
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
  /** Present only when the page was opened as `?mode=route&supply=…`. */
  route?: RouteContext
  /** Present when cable measuring may be STARTED from this drawing. */
  cableSchedule?: CableScheduleContext
  /** Every saved route leg on this sheet, for the overlay in any mode. */
  sheetLegs?: OtherLeg[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [routeError, setRouteError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)

  // The route as the browser knows it. Seeded from the server, then replaced
  // with what each save action returns, so a saved leg is on the sheet the
  // moment the server confirms it — `router.refresh()` alone left the view
  // unchanged until a hard reload, which reads as "my trace vanished". A later
  // server render (new supply, refresh) re-seeds it; the server stays truth.
  const [segments, setSegments] = useState<RouteContext['segments']>(route?.segments ?? [])
  useEffect(() => { setSegments(route?.segments ?? []) }, [route])
  // The token the next save must present. Refreshed from every successful save.
  const [routeUpdatedAt, setRouteUpdatedAt] = useState<string | null>(route?.updatedAt ?? null)
  useEffect(() => { setRouteUpdatedAt(route?.updatedAt ?? null) }, [route])
  const [conflict, setConflict] = useState(false)
  // History (lazy) and re-measure state for the rail.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<RouteHistoryEntry[] | null>(null)
  const [remeasurePreview, setRemeasurePreview] = useState<Array<{ id: string; seq: number; beforeM: number; afterM: number }> | null>(null)
  // Two-step inline confirmation, never window.confirm(): Safari suppresses
  // that dialog silently (the snag module's lesson, PR #158). First press
  // arms, second press within 4 s commits.
  const [armedRestoreId, setArmedRestoreId] = useState<string | null>(null)
  useEffect(() => {
    if (!armedRestoreId) return
    const t = setTimeout(() => setArmedRestoreId(null), 4000)
    return () => clearTimeout(t)
  }, [armedRestoreId])

  /**
   * Persist the whole segment list. `saveSupplyRouteAction` REPLACES the list,
   * so append, edit and delete are all "send the new list" — one path, one set
   * of guards, no way for the three to disagree about rise and drop.
   *
   * ⚠ A segment whose drawing has since been deleted (`floor_plan_id` is ON
   * DELETE SET NULL) cannot be resent — the schema requires a uuid — so any
   * write in that state would silently drop a leg and shorten the run. Refuse
   * instead, and say so.
   */
  const persistSegments = useCallback(
    async (next: Array<{ floorPlanId: string | null; pageIndex: number; points: number[] }>) => {
      if (!route) return {}
      const orphaned = next.filter((g) => !g.floorPlanId)
      if (orphaned.length > 0) {
        const msg = `This run has ${orphaned.length} leg${orphaned.length === 1 ? '' : 's'} traced on a drawing that is no longer available, so it cannot be changed safely. Remove the route from the worklist and retrace it.`
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
          segments: next.map((g) => ({ floorPlanId: g.floorPlanId as string, pageIndex: g.pageIndex, points: g.points })),
          expectedUpdatedAt: routeUpdatedAt,
        })
        if (res.error) {
          setRouteError(res.error)
          if (res.conflict) setConflict(true)
          return { error: res.error }
        }
        if (res.updatedAt) setRouteUpdatedAt(res.updatedAt)
        setHistoryEntries(null)
        if (res.segments) {
          setSegments(
            res.segments.map((g) => ({
              id: g.id,
              floorPlanId: g.floorPlanId,
              floorPlanName: g.floorPlanName,
              pageIndex: g.pageIndex,
              points: g.points,
              pixelsPerMeter: g.pixelsPerMeter,
              lengthM: g.lengthM,
            })),
          )
        }
        // No router.refresh() here, on purpose. The server re-renders this
        // page with a NEW signed URL for the PDF every time, and the canvas
        // keys its load on that URL — so a refresh after each save blanked the
        // sheet for a full re-rasterise, several seconds of "where did my
        // drawing go". The route state above is authoritative for this run;
        // the worklist is revalidated by the action itself.
        return {}
      } finally {
        setCommitting(false)
      }
    },
    [route, routeUpdatedAt],
  )

  const applyRestored = useCallback((res: Awaited<ReturnType<typeof restoreRouteHistoryAction>>) => {
    if (res.segments) {
      setSegments(res.segments.map((g) => ({ id: g.id, floorPlanId: g.floorPlanId, floorPlanName: g.floorPlanName, pageIndex: g.pageIndex, points: g.points, pixelsPerMeter: g.pixelsPerMeter, lengthM: g.lengthM })))
    }
    if (res.updatedAt) setRouteUpdatedAt(res.updatedAt)
    setHistoryEntries(null)
    router.refresh()
  }, [router])

  const loadHistory = useCallback(async () => {
    if (!route) return
    setHistoryOpen(true)
    const res = await listRouteHistoryAction({ supplyId: route.supplyId })
    setHistoryEntries(res.entries ?? [])
    if (res.error) setRouteError(res.error)
  }, [route])

  // A save clears the entries so the list cannot go stale; while the panel is
  // open that must refetch, or it sits on "Loading history…" forever.
  useEffect(() => {
    if (historyOpen && historyEntries == null) void loadHistory()
  }, [historyOpen, historyEntries, loadHistory])

  const restore = useCallback(async (historyId: string) => {
    if (!route) return
    if (armedRestoreId !== historyId) { setArmedRestoreId(historyId); return }
    setArmedRestoreId(null)
    setCommitting(true)
    try {
      const res = await restoreRouteHistoryAction({ supplyId: route.supplyId, historyId })
      if (res.error) { setRouteError(res.error); return }
      setRouteError(null)
      applyRestored(res)
    } finally {
      setCommitting(false)
    }
  }, [route, applyRestored, armedRestoreId])

  const staleOnThisSheet = segments.filter(
    (g) => g.floorPlanId === plan.id && plan.pixels_per_meter != null && isSegmentCalibrationStale({ pixels_per_meter: g.pixelsPerMeter }, plan.pixels_per_meter),
  )
  const previewRemeasure = useCallback(async () => {
    if (!route) return
    const res = await remeasureRouteLegsAction({ supplyId: route.supplyId, floorPlanId: plan.id, pageIndex: 1, dryRun: true })
    if (res.error) { setRouteError(res.error); return }
    setRemeasurePreview(res.legs ?? [])
  }, [route, plan.id])
  const confirmRemeasure = useCallback(async () => {
    if (!route) return
    setCommitting(true)
    try {
      const res = await remeasureRouteLegsAction({ supplyId: route.supplyId, floorPlanId: plan.id, pageIndex: 1 })
      if (res.error) { setRouteError(res.error); return }
      setSegments((cur) => cur.map((g) => { const l = res.legs?.find((x) => x.id === g.id); return l ? { ...g, lengthM: l.afterM, pixelsPerMeter: l.afterPpm } : g }))
      setRemeasurePreview(null)
      setHistoryEntries(null)
      router.refresh()
    } finally {
      setCommitting(false)
    }
  }, [route, plan.id, router])

  const onCommitLeg = useCallback(
    ({ points, pageIndex }: { points: number[]; pageIndex: number }) =>
      persistSegments([...segments, { floorPlanId: plan.id, pageIndex, points }]),
    [persistSegments, segments, plan.id],
  )

  const onUpdateLeg = useCallback(
    (legId: string, points: number[]) =>
      persistSegments(segments.map((g) => (g.id === legId ? { ...g, points } : g))),
    [persistSegments, segments],
  )

  const onExportSheet = useCallback(
    async (jpegBase64: string, pageIndex: number) => {
      if (!route) return { error: 'No run is being measured.' }
      const res = await exportRouteSheetAction({ floorPlanId: plan.id, revisionId: route.revisionId, pageIndex, jpegBase64 })
      return res.error ? { error: res.error } : { version: res.version }
    },
    [route, plan.id],
  )

  const onDeleteLeg = useCallback(
    (legId: string) => persistSegments(segments.filter((g) => g.id !== legId)),
    [persistSegments, segments],
  )

  /** Undo/redo re-persists a whole prior leg list. */
  const onReplaceLegs = useCallback(
    (legs: Array<{ floorPlanId: string; pageIndex: number; points: number[] }>) =>
      persistSegments(legs.map((l) => ({ floorPlanId: l.floorPlanId || null, pageIndex: l.pageIndex, points: l.points }))),
    [persistSegments],
  )

  /** Move a leg up or down the run; seq is rewritten on save. */
  const onReorderLeg = useCallback(
    (index: number, dir: -1 | 1) => {
      const j = index + dir
      if (j < 0 || j >= segments.length) return Promise.resolve({})
      const next = [...segments]
      ;[next[index], next[j]] = [next[j], next[index]]
      return persistSegments(next)
    },
    [persistSegments, segments],
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
            style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger, #b4413c)', borderColor: 'var(--c-danger, #b4413c)', display: 'flex', gap: 10, alignItems: 'center' }}
            role="alert"
          >
            <span style={{ flex: 1 }}>{routeError}</span>
            {conflict && (
              <button type="button" className="btn-primary-amber" onClick={() => window.location.reload()}>Reload</button>
            )}
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
          cablePicker={
            cableSchedule
              ? {
                  revisionCode: cableSchedule.revisionCode,
                  runs: cableSchedule.runs,
                  activeSupplyId: route?.supplyId,
                  // Entering route mode goes through the URL so the server
                  // re-runs the schedule-role gate and loads the run's existing
                  // legs — the same door the worklist uses, not a second one.
                  onPick: (supplyId: string) =>
                    router.push(`${pathname}?mode=route&supply=${supplyId}`),
                }
              : undefined
          }
          routeOverlay={{
            legs: sheetLegs,
            // Measuring from a pressed route needs the schedule write role —
            // the same gate that decides whether the ⚡ tool exists.
            onMeasure: cableSchedule
              ? (supplyId: string) => router.push(`${pathname}?mode=route&supply=${supplyId}`)
              : undefined,
          }}
          plan={plan}
          snagPins={snagPins}
          projectId={projectId}
          rfis={rfis}
          editing={editing}
          mode={route ? 'route' : mode}
          routeMode={
            route
              ? {
                  supplyId: route.supplyId,
                  runLabel: route.runLabel,
                  savedLegs: segments.map((g) => ({
                    id: g.id,
                    floorPlanId: g.floorPlanId,
                    floorPlanName: g.floorPlanName,
                    pageIndex: g.pageIndex,
                    points: g.points,
                    lengthM: g.lengthM,
                  })),
                  otherLegsOnSheet: route.otherLegsOnSheet,
                  onCommitLeg,
                  onUpdateLeg,
                  onDeleteLeg,
                  onReplaceLegs,
                  onExportSheet,
                  sheets: route.sheets,
                  riseM: route.riseM,
                  dropM: route.dropM,
                  scheduleLengthM: route.scheduleLengthM,
                  onSwitchSheet: (planId: string) =>
                    router.push(`/projects/${projectId}/floor-plans/${planId}?mode=route&supply=${route.supplyId}`),
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
                {committing ? 'saving…' : segments.length}
              </span>
            </div>
            {segments.length === 0 ? (
              <div className="data-panel-empty">
                Nothing traced yet. Pick the polyline tool and click along the route.
              </div>
            ) : (
              segments.map((g, i) => (
                <div key={g.id} className="data-panel-row" style={{ gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i + 1}. {g.floorPlanName}
                      {!g.floorPlanId && ' (drawing removed)'}
                      {g.floorPlanId === plan.id &&
                        isSegmentCalibrationStale({ pixels_per_meter: g.pixelsPerMeter }, plan.pixels_per_meter) && (
                          <span style={{ color: 'var(--c-amber)' }}> · sheet re-scaled since tracing</span>
                        )}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      page {g.pageIndex}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)' }}>
                    {g.lengthM.toFixed(2)} m
                  </span>
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    <button type="button" onClick={() => void onReorderLeg(i, -1)} disabled={i === 0 || committing} title="Move this leg earlier in the run" style={legBtn}>↑</button>
                    <button type="button" onClick={() => void onReorderLeg(i, 1)} disabled={i === segments.length - 1 || committing} title="Move this leg later in the run" style={legBtn}>↓</button>
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
                {segments.reduce((n, g) => n + g.lengthM, 0).toFixed(2)} m
              </span>
            </div>
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--c-text-dim)', lineHeight: 1.5 }}>
              Tracing never changes a cable length on its own. Add rise and drop, then assign.
            </div>
            {staleOnThisSheet.length > 0 && (
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--c-border)', fontSize: 12 }}>
                <div style={{ color: 'var(--c-amber)', marginBottom: 6 }}>
                  {staleOnThisSheet.length} leg{staleOnThisSheet.length === 1 ? '' : 's'} on this sheet {staleOnThisSheet.length === 1 ? 'was' : 'were'} traced under a different scale.
                </div>
                {remeasurePreview ? (
                  <>
                    {remeasurePreview.map((l) => (
                      <div key={l.id} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>leg {l.seq}: {l.beforeM.toFixed(2)} m → {l.afterM.toFixed(2)} m</div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button type="button" className="btn-primary-amber" onClick={() => void confirmRemeasure()} disabled={committing}>Re-measure {remeasurePreview.length} leg{remeasurePreview.length === 1 ? '' : 's'}</button>
                      <button type="button" onClick={() => setRemeasurePreview(null)} style={legBtnWide}>Keep as traced</button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => void previewRemeasure()} style={legBtnWide} disabled={committing}>Show what re-measuring would change</button>
                )}
              </div>
            )}
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--c-border)', fontSize: 12 }}>
              {!historyOpen ? (
                <button type="button" onClick={() => void loadHistory()} style={legBtnWide}>History…</button>
              ) : historyEntries == null ? (
                <span style={{ color: 'var(--c-text-dim)' }}>Loading history…</span>
              ) : historyEntries.length === 0 ? (
                <span style={{ color: 'var(--c-text-dim)' }}>No saves yet.</span>
              ) : (
                historyEntries.map((h, i) => (
                  <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid var(--c-border)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11 }}>
                      {new Date(h.savedAt).toLocaleString()} · {h.reason} · {h.legs} leg{h.legs === 1 ? '' : 's'} · {h.tracedM.toFixed(2)} m
                    </span>
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => void restore(h.id)}
                        disabled={committing}
                        style={armedRestoreId === h.id ? { ...legBtnWide, background: 'var(--c-amber)', color: '#1a1a1a', borderColor: 'var(--c-amber)' } : legBtnWide}
                        title={armedRestoreId === h.id ? 'Press again to put the route back to this state — the current state stays in history' : 'Put the route back to this state'}
                      >
                        {armedRestoreId === h.id ? 'Confirm restore' : 'Restore'}
                      </button>
                    )}
                    {i === 0 && <span style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>current</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
        {route ? (
          <AssignRoutePanel
            key={route.supplyId}
            compact
            supplyId={route.supplyId}
            segments={segments}
            initialRiseM={route.riseM}
            initialDropM={route.dropM}
            scheduleLengthM={route.scheduleLengthM}
            strands={route.strands}
            // A rise/drop save or an Assign is a history row too — clear the
            // cached list so an open History panel refetches it.
            onChanged={() => { setHistoryEntries(null); router.refresh() }}
          />
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

const legBtn: React.CSSProperties = {
  width: 20,
  height: 20,
  padding: 0,
  fontSize: 11,
  lineHeight: '18px',
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  background: 'var(--c-panel)',
  color: 'var(--c-text-mid)',
  cursor: 'pointer',
}

const legBtnWide: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  background: 'var(--c-panel)',
  color: 'var(--c-text-mid)',
  cursor: 'pointer',
}
