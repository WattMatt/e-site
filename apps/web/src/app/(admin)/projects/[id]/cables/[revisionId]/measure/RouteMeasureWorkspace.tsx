'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { isSegmentCalibrationStale } from '@esite/shared'
import {
  saveSupplyRouteAction,
  exportRouteSheetAction,
  listRouteHistoryAction,
  restoreRouteHistoryAction,
  remeasureRouteLegsAction,
  deleteSupplyRouteAction,
  type RouteHistoryEntry,
} from '@/actions/cable-route.actions'
import { AssignRoutePanel } from '@/components/cable-route/AssignRoutePanel'
import type { OtherLeg } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/RouteLayer'
import { applySaveToRun, applyCalibrationToSheet, lastSheetOf } from './route-canvas-logic'
import type { ActiveSheet, PlanRow, RunRow, RunSegment } from './types'

const RouteCanvas = dynamic(() => import('./RouteCanvas').then((m) => m.RouteCanvas), {
  ssr: false,
  loading: () => (
    <div style={{ height: 480, background: 'var(--c-base)', border: '1px solid var(--c-border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      Loading canvas…
    </div>
  ),
})

type Filter = 'outstanding' | 'traced' | 'all'

/**
 * The measuring session: worklist on the left, the sheet in the middle, the
 * run on the right.
 *
 * The run list lives in state seeded from the server and re-seeded whenever
 * the server re-renders. A save folds its result into the selected run
 * (`applySaveToRun`) rather than calling `router.refresh()`, because a refresh
 * re-mints the sheet's signed URL under the canvas — the canvas reads it
 * through a ref keyed on the sheet id, so it would not re-rasterise, but the
 * list would also not change until the refresh landed. Folding the result in
 * makes the list right the moment the server confirms.
 *
 * The persist path is ONE function that replaces the whole segment list —
 * append, edit, delete, reorder and undo are all "send the new list" — so
 * there is one set of guards and no way for them to disagree about rise/drop.
 */
const NO_SEGMENTS: RunSegment[] = []

export function RouteMeasureWorkspace({
  revisionId,
  runs,
  plans,
  initialSupplyId,
  activeSheet,
  initialPage,
  otherLegsOnSheet,
}: {
  revisionId: string
  runs: RunRow[]
  plans: PlanRow[]
  /** Preselected run, already validated against `runs`. */
  initialSupplyId?: string
  /** The sheet the server minted a URL for, or null when the project has no drawings. */
  activeSheet: ActiveSheet | null
  initialPage: number
  otherLegsOnSheet: OtherLeg[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  // ── Server-seeded state ───────────────────────────────────────────────────
  const [runsState, setRunsState] = useState<RunRow[]>(runs)
  useEffect(() => { setRunsState(runs) }, [runs])
  const [sheet, setSheet] = useState<ActiveSheet | null>(activeSheet)
  useEffect(() => { setSheet(activeSheet) }, [activeSheet])
  const [selectedId, setSelectedId] = useState<string | null>(initialSupplyId ?? null)
  useEffect(() => { setSelectedId(initialSupplyId ?? null) }, [initialSupplyId])
  const selected = runsState.find((r) => r.supplyId === selectedId) ?? null
  const segments: RunSegment[] = useMemo(() => selected?.route?.segments ?? NO_SEGMENTS, [selected])

  // ── Worklist ──────────────────────────────────────────────────────────────
  const initialRun = initialSupplyId ? runs.find((r) => r.supplyId === initialSupplyId) : undefined
  // A deep-linked run must be visible: an already-traced run is not on the
  // outstanding list, so widen the filter rather than silently drop it.
  const [filter, setFilter] = useState<Filter>(initialRun?.route && initialRun.route.segments.length > 0 ? 'all' : 'outstanding')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'length' | 'status'>('name')
  const [listOpen, setListOpen] = useState(true)
  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans])
  const traced = (r: RunRow) => !!r.route && r.route.segments.length > 0
  const visible = useMemo(() => {
    let list = filter === 'outstanding' ? runsState.filter((r) => !traced(r)) : filter === 'traced' ? runsState.filter(traced) : runsState
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((r) => `${r.fromCode} ${r.toCode} ${r.section ?? ''}`.toLowerCase().includes(q))
    const label = (r: RunRow) => `${r.fromCode} → ${r.toCode}`
    return [...list].sort((a, b) =>
      sort === 'length'
        ? (b.route?.totalM ?? b.scheduleLengthM ?? -1) - (a.route?.totalM ?? a.scheduleLengthM ?? -1) || label(a).localeCompare(label(b))
        : sort === 'status'
          ? Number(traced(a)) - Number(traced(b)) || label(a).localeCompare(label(b))
          : label(a).localeCompare(label(b)),
    )
  }, [runsState, filter, query, sort])
  const outstandingCount = runsState.filter((r) => !traced(r)).length

  /** Every run with its route figures, as a file the schedule people can keep. */
  const downloadCsv = useCallback(() => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['From', 'To', 'Section', 'Strands', 'Legs', 'Sheets', 'Traced (m)', 'Rise (m)', 'Drop (m)', 'Route total (m)', 'Schedule length (m)', 'On schedule'],
      ...runsState.map((r) => [
        r.fromCode, r.toCode, r.section ?? '', r.strands,
        r.route?.segments.length ?? 0,
        r.route ? [...new Set(r.route.segments.map((g) => g.floorPlanName))].join('; ') : '',
        r.route ? r.route.tracedM.toFixed(2) : '', r.route ? r.route.riseM : '', r.route ? r.route.dropM : '',
        r.route ? r.route.totalM.toFixed(2) : '',
        r.scheduleLengthM == null ? '' : r.scheduleLengthM.toFixed(2),
        r.route && r.scheduleLengthM != null && Math.abs(r.scheduleLengthM - r.route.totalM) < 0.005 ? 'yes' : 'no',
      ]),
    ]
    const blob = new Blob([rows.map((row) => row.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cable-routes-${revisionId.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [runsState, revisionId])

  // ── URL: the run, the sheet and the page are the address of this view ─────
  const navigate = useCallback(
    (next: { supply?: string | null; sheet?: string | null; page?: number | null }) => {
      const params = new URLSearchParams()
      const supply = next.supply === undefined ? selectedId : next.supply
      const sheetId = next.sheet === undefined ? sheet?.id ?? null : next.sheet
      const page = next.page === undefined ? null : next.page
      if (supply) params.set('supply', supply)
      if (sheetId) params.set('sheet', sheetId)
      if (page && page > 1) params.set('page', String(page))
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [router, pathname, selectedId, sheet?.id],
  )
  const selectRun = useCallback(
    (run: RunRow) => {
      setSelectedId(run.supplyId)
      setMessage(null)
      setRouteError(null)
      setHistoryOpen(false)
      setHistoryEntries(null)
      setRemeasurePreview(null)
      // Continue on the sheet this run was last traced on, else stay put.
      const last = lastSheetOf(run)
      navigate({ supply: run.supplyId, sheet: last?.planId ?? sheet?.id ?? null, page: last?.page ?? null })
    },
    [navigate, sheet?.id],
  )
  const [currentPage, setCurrentPage] = useState(initialPage)
  const onPageChange = useCallback((page: number) => {
    setCurrentPage(page)
    // The page is part of the address, but only replace when it differs — the
    // canvas reports its page on mount too.
    const url = new URL(window.location.href)
    const cur = Number(url.searchParams.get('page') ?? '1')
    if (cur !== page) navigate({ page })
  }, [navigate])

  // ── Persisting the route ──────────────────────────────────────────────────
  const [routeError, setRouteError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<RouteHistoryEntry[] | null>(null)
  const [remeasurePreview, setRemeasurePreview] = useState<Array<{ id: string; seq: number; beforeM: number; afterM: number }> | null>(null)
  const [armedRestoreId, setArmedRestoreId] = useState<string | null>(null)
  useEffect(() => {
    if (!armedRestoreId) return
    const t = setTimeout(() => setArmedRestoreId(null), 4000)
    return () => clearTimeout(t)
  }, [armedRestoreId])
  const [pending, startTransition] = useTransition()

  const foldSave = useCallback(
    (supplyId: string, res: { segments?: Array<{ id: string; floorPlanId: string | null; floorPlanName: string; pageIndex: number; points: number[]; pixelsPerMeter: number; lengthM: number }>; updatedAt?: string | null; riseM?: number; dropM?: number }) => {
      setRunsState((cur) =>
        cur.map((r) => {
          if (r.supplyId !== supplyId) return r
          const segs: RunSegment[] = (res.segments ?? r.route?.segments ?? []).map((g, i) => ({
            id: g.id, seq: i + 1, floorPlanId: g.floorPlanId, floorPlanName: g.floorPlanName,
            pageIndex: g.pageIndex, points: g.points, pixelsPerMeter: g.pixelsPerMeter, lengthM: g.lengthM,
          }))
          return applySaveToRun(r, {
            segments: segs,
            riseM: res.riseM ?? r.route?.riseM ?? 0,
            dropM: res.dropM ?? r.route?.dropM ?? 0,
            updatedAt: res.updatedAt ?? r.route?.updatedAt ?? null,
          })
        }),
      )
    },
    [],
  )

  /**
   * ⚠ A segment whose drawing has since been deleted cannot be resent (the
   * schema requires a uuid), so any write in that state would silently drop
   * a leg and shorten the run. Refuse instead, and say so.
   */
  const persistSegments = useCallback(
    async (next: Array<{ floorPlanId: string | null; pageIndex: number; points: number[] }>) => {
      if (!selected) return { error: 'Pick a run first.' }
      const orphaned = next.filter((g) => !g.floorPlanId)
      if (orphaned.length > 0) {
        const msg = `This run has ${orphaned.length} leg${orphaned.length === 1 ? '' : 's'} traced on a drawing that is no longer available, so it cannot be changed safely. Remove the route and retrace it.`
        setRouteError(msg)
        return { error: msg }
      }
      setCommitting(true)
      setRouteError(null)
      try {
        const res = await saveSupplyRouteAction({
          supplyId: selected.supplyId,
          riseM: selected.route?.riseM ?? 0,
          dropM: selected.route?.dropM ?? 0,
          segments: next.map((g) => ({ floorPlanId: g.floorPlanId as string, pageIndex: g.pageIndex, points: g.points })),
          expectedUpdatedAt: selected.route?.updatedAt ?? null,
        })
        if (res.error) {
          setRouteError(res.error)
          if (res.conflict) setConflict(true)
          return { error: res.error }
        }
        setHistoryEntries(null)
        foldSave(selected.supplyId, res)
        return {}
      } finally {
        setCommitting(false)
      }
    },
    [selected, foldSave],
  )

  const onCommitLeg = useCallback(
    ({ points, pageIndex }: { points: number[]; pageIndex: number }) =>
      sheet ? persistSegments([...segments, { floorPlanId: sheet.id, pageIndex, points }]) : Promise.resolve({ error: 'No sheet is open.' }),
    [persistSegments, segments, sheet],
  )
  const onUpdateLeg = useCallback(
    (legId: string, points: number[]) => persistSegments(segments.map((g) => (g.id === legId ? { ...g, points } : g))),
    [persistSegments, segments],
  )
  const onDeleteLeg = useCallback((legId: string) => persistSegments(segments.filter((g) => g.id !== legId)), [persistSegments, segments])
  const onReplaceLegs = useCallback(
    (legs: Array<{ floorPlanId: string; pageIndex: number; points: number[] }>) =>
      persistSegments(legs.map((l) => ({ floorPlanId: l.floorPlanId || null, pageIndex: l.pageIndex, points: l.points }))),
    [persistSegments],
  )
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
  const onExportSheet = useCallback(
    async (jpegBase64: string, pageIndex: number) => {
      if (!sheet) return { error: 'No sheet is open.' }
      const res = await exportRouteSheetAction({ floorPlanId: sheet.id, revisionId, pageIndex, jpegBase64 })
      if (!res.error) router.refresh()
      return res.error ? { error: res.error } : { version: res.version }
    },
    [sheet, revisionId, router],
  )
  const onCalibrated = useCallback((c: { pageIndex: number; pixelsPerMeter: number; points: number[]; metres: number }) => {
    setSheet((s) => (s ? applyCalibrationToSheet(s, c) : s))
    // The list's "(no scale yet)" marks and the stale checks read server data.
    router.refresh()
  }, [router])

  // ── History, restore, re-measure ──────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!selected) return
    setHistoryOpen(true)
    const res = await listRouteHistoryAction({ supplyId: selected.supplyId })
    setHistoryEntries(res.entries ?? [])
    if (res.error) setRouteError(res.error)
  }, [selected])
  useEffect(() => {
    if (historyOpen && historyEntries == null) void loadHistory()
  }, [historyOpen, historyEntries, loadHistory])
  const restore = useCallback(async (historyId: string) => {
    if (!selected) return
    if (armedRestoreId !== historyId) { setArmedRestoreId(historyId); return }
    setArmedRestoreId(null)
    setCommitting(true)
    try {
      const res = await restoreRouteHistoryAction({ supplyId: selected.supplyId, historyId })
      if (res.error) { setRouteError(res.error); return }
      setRouteError(null)
      setHistoryEntries(null)
      foldSave(selected.supplyId, res)
      router.refresh()
    } finally {
      setCommitting(false)
    }
  }, [selected, armedRestoreId, foldSave, router])

  const staleOnThisSheet = sheet
    ? segments.filter((g) => g.floorPlanId === sheet.id && sheet.pixels_per_meter != null && isSegmentCalibrationStale({ pixels_per_meter: g.pixelsPerMeter }, sheet.pixels_per_meter))
    : []
  const previewRemeasure = useCallback(async () => {
    if (!selected || !sheet) return
    const res = await remeasureRouteLegsAction({ supplyId: selected.supplyId, floorPlanId: sheet.id, pageIndex: currentPage, dryRun: true })
    if (res.error) { setRouteError(res.error); return }
    setRemeasurePreview(res.legs ?? [])
  }, [selected, sheet, currentPage])
  const confirmRemeasure = useCallback(async () => {
    if (!selected || !sheet) return
    setCommitting(true)
    try {
      const res = await remeasureRouteLegsAction({ supplyId: selected.supplyId, floorPlanId: sheet.id, pageIndex: currentPage })
      if (res.error) { setRouteError(res.error); return }
      setRemeasurePreview(null)
      setHistoryEntries(null)
      router.refresh()
    } finally {
      setCommitting(false)
    }
  }, [selected, sheet, currentPage, router])

  const removeRoute = useCallback(() => {
    if (!selected) return
    startTransition(async () => {
      const res = await deleteSupplyRouteAction({ supplyId: selected.supplyId })
      setMessage(res.error ?? 'Route removed. The run is back on the outstanding list.')
      if (!res.error) router.refresh()
    })
  }, [selected, router])

  const runLabel = selected ? `${selected.fromCode} → ${selected.toCode}` : ''
  const canvasRun = useMemo(
    () =>
      selected
        ? {
            supplyId: selected.supplyId,
            label: runLabel,
            riseM: selected.route?.riseM ?? 0,
            dropM: selected.route?.dropM ?? 0,
            scheduleLengthM: selected.scheduleLengthM,
            savedLegs: segments.map((g) => ({ id: g.id, floorPlanId: g.floorPlanId, floorPlanName: g.floorPlanName, pageIndex: g.pageIndex, points: g.points, lengthM: g.lengthM })),
            // The server excludes the run it was asked for; between picking a
            // different run here and that re-render landing, exclude it again
            // so the new run's own legs are not also drawn faint as "other".
            otherLegsOnSheet: otherLegsOnSheet.filter((l) => l.supplyId !== selected.supplyId),
          }
        : null,
    [selected, runLabel, segments, otherLegsOnSheet],
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${listOpen ? '300px' : '36px'} minmax(0, 1fr) 300px`, gap: 12, alignItems: 'start' }}>
      {/* ── Worklist ──────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10, overflow: 'hidden' }}>
        {!listOpen ? (
          <button type="button" onClick={() => setListOpen(true)} title="Show the run list" aria-label="Show the run list" style={{ ...btn('ghost'), width: '100%', padding: '10px 0', border: 'none', borderRadius: 0 }}>
            ▸
          </button>
        ) : (
          <>
            <div style={{ padding: 8, borderBottom: '1px solid var(--c-border)' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search runs…" aria-label="Search runs" style={{ ...inputStyle, flex: 1, marginTop: 0 }} />
                <button type="button" onClick={() => setListOpen(false)} title="Hide the run list" aria-label="Hide the run list" style={{ ...btn('ghost'), padding: '6px 8px' }}>◂</button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 11, color: 'var(--c-text-dim)' }}>
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'length' | 'status')} aria-label="Sort runs" style={{ ...inputStyle, width: 'auto', marginTop: 0, padding: '3px 6px' }}>
                  <option value="name">by name</option>
                  <option value="length">by length</option>
                  <option value="status">outstanding first</option>
                </select>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={downloadCsv} style={{ ...btn('ghost'), padding: '4px 8px', fontSize: 11 }} title="Every run with its legs, sheets, traced, rise, drop, total and schedule length">
                  Routes CSV
                </button>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['outstanding', 'traced', 'all'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    style={{
                      flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 6, textTransform: 'capitalize', cursor: 'pointer',
                      border: '1px solid ' + (filter === f ? 'var(--c-amber)' : 'var(--c-border)'),
                      background: filter === f ? 'var(--c-amber)' : 'transparent',
                      color: filter === f ? '#0D0B09' : 'var(--c-text)',
                    }}
                  >
                    {f}{f === 'outstanding' ? ` (${outstandingCount})` : ''}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
              {visible.length === 0 && (
                <p style={{ padding: 16, margin: 0, fontSize: 13, color: 'var(--c-text-dim)' }}>
                  {filter === 'outstanding' ? 'Every run on this revision has a traced route.' : 'Nothing here yet.'}
                </p>
              )}
              {visible.map((r) => {
                const isSel = r.supplyId === selectedId
                const stale = r.route?.segments.some((s) =>
                  isSegmentCalibrationStale({ pixels_per_meter: s.pixelsPerMeter }, s.floorPlanId ? planById.get(s.floorPlanId)?.pixelsPerMeter ?? null : null),
                ) ?? false
                return (
                  <button
                    key={r.supplyId}
                    type="button"
                    onClick={() => selectRun(r)}
                    aria-current={isSel ? 'true' : undefined}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none',
                      borderLeft: `3px solid ${isSel ? 'var(--c-amber)' : 'transparent'}`,
                      borderBottom: '1px solid var(--c-border)',
                      background: isSel ? 'var(--c-surface-2)' : 'transparent', cursor: 'pointer', color: 'var(--c-text)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.fromCode} → {r.toCode}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      {r.voltageV} V · {r.strands} strand{r.strands === 1 ? '' : 's'}
                      {r.scheduleLengthM != null && ` · schedule ${r.scheduleLengthM} m`}
                    </div>
                    {traced(r) && (
                      <div style={{ fontSize: 11, marginTop: 3, color: stale ? 'var(--c-amber)' : 'var(--c-green, #34D399)' }}>
                        {stale ? '⚠ drawing recalibrated since tracing' : `traced ${r.route!.totalM.toFixed(2)} m`}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Sheet ─────────────────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        {routeError && (
          <div className="data-panel" role="alert" style={{ padding: '8px 12px', marginBottom: 8, fontSize: 12, color: 'var(--c-danger, #b4413c)', borderColor: 'var(--c-danger, #b4413c)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{routeError}</span>
            {conflict && <button type="button" className="btn-primary-amber" onClick={() => window.location.reload()}>Reload</button>}
          </div>
        )}
        {!selected ? (
          <div style={{ border: '1px dashed var(--c-border)', borderRadius: 10, padding: 48, textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 14 }}>
            Pick a run from the list to start measuring.
          </div>
        ) : plans.length === 0 || !sheet ? (
          <div style={{ border: '1px dashed var(--c-border)', borderRadius: 10, padding: 48, textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 14 }}>
            {plans.length === 0
              ? 'This project has no drawings loaded, so there is nothing to trace a route on. Upload the power layouts under Floor Plans first.'
              : 'None of this project’s drawings can be shown here. Tracing needs a PDF, PNG, JPG, WebP or SVG drawing.'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--c-text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Sheet
                <select
                  className="ob-input"
                  style={{ fontSize: 12, maxWidth: 360 }}
                  value={sheet.id}
                  onChange={(e) => { if (e.target.value !== sheet.id) navigate({ sheet: e.target.value, page: null }) }}
                  aria-label="Drawing to trace on"
                >
                  {plans.map((pl) => (
                    <option key={pl.id} value={pl.id} disabled={!pl.renderable}>
                      {pl.name}{pl.pixelsPerMeter ? '' : ' (no scale yet)'}{pl.renderable ? '' : ' (cannot be shown)'}
                    </option>
                  ))}
                </select>
              </label>
              <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                A run may cross sheets: save the leg here, then pick the next sheet and keep tracing.
              </span>
            </div>
            {canvasRun && (
              <RouteCanvas
                key={sheet.id}
                sheet={sheet}
                run={canvasRun}
                initialPage={initialPage}
                onPageChange={onPageChange}
                busy={committing}
                onCommitLeg={onCommitLeg}
                onUpdateLeg={onUpdateLeg}
                onDeleteLeg={onDeleteLeg}
                onReplaceLegs={onReplaceLegs}
                onExportSheet={onExportSheet}
                onCalibrated={onCalibrated}
                height="calc(100vh - 330px)"
              />
            )}
          </>
        )}
      </div>

      {/* ── The run ───────────────────────────────────────────────────────── */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {selected ? (
          <>
            <div className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">Legs traced</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>{committing ? 'saving…' : segments.length}</span>
              </div>
              {segments.length === 0 ? (
                <div className="data-panel-empty">Nothing traced yet. Click along the route on the sheet, double-click to finish, then Save leg.</div>
              ) : (
                segments.map((g, i) => (
                  <div key={g.id} className="data-panel-row" style={{ gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {i + 1}. {g.floorPlanName}
                        {!g.floorPlanId && ' (drawing removed)'}
                        {sheet && g.floorPlanId === sheet.id && isSegmentCalibrationStale({ pixels_per_meter: g.pixelsPerMeter }, sheet.pixels_per_meter) && (
                          <span style={{ color: 'var(--c-amber)' }}> · sheet re-scaled since tracing</span>
                        )}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                        {g.floorPlanId && g.floorPlanId !== sheet?.id ? (
                          <button type="button" onClick={() => navigate({ sheet: g.floorPlanId, page: g.pageIndex })} style={{ ...legBtnWide, padding: '1px 6px', fontSize: 10 }} title="Open the sheet this leg is on">
                            open · page {g.pageIndex}
                          </button>
                        ) : (
                          <>page {g.pageIndex}</>
                        )}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)' }}>{g.lengthM.toFixed(2)} m</span>
                    <span style={{ display: 'inline-flex', gap: 2 }}>
                      <button type="button" onClick={() => void onReorderLeg(i, -1)} disabled={i === 0 || committing} title="Move this leg earlier in the run" style={legBtn}>↑</button>
                      <button type="button" onClick={() => void onReorderLeg(i, 1)} disabled={i === segments.length - 1 || committing} title="Move this leg later in the run" style={legBtn}>↓</button>
                    </span>
                  </div>
                ))
              )}
              <div className="data-panel-row" style={{ gap: 10, borderTop: '1px solid var(--c-border)', fontWeight: 700 }}>
                <div style={{ flex: 1, fontSize: 12 }}>Traced</div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{segments.reduce((n, g) => n + g.lengthM, 0).toFixed(2)} m</span>
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
            <AssignRoutePanel
              key={selected.supplyId}
              compact
              supplyId={selected.supplyId}
              segments={segments}
              initialRiseM={selected.route?.riseM ?? 0}
              initialDropM={selected.route?.dropM ?? 0}
              scheduleLengthM={selected.scheduleLengthM}
              strands={selected.strands}
              // A rise/drop save or an Assign is a history row too; the server
              // re-render brings the new figures into the list.
              onChanged={() => { setHistoryEntries(null); router.refresh() }}
            />
            {selected.route && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={removeRoute} disabled={pending} style={btn('ghost')}>Remove route</button>
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Deletes the traced legs. The schedule keeps whatever length it holds.</span>
              </div>
            )}
            {message && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-dim)' }}>{message}</p>}
          </>
        ) : (
          <div className="data-panel">
            <div className="data-panel-empty">
              {outstandingCount === 0 ? 'Every run is traced. Pick one to review or re-measure it.' : `${outstandingCount} run${outstandingCount === 1 ? '' : 's'} still to trace.`}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  width: 90,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-bg)',
  color: 'var(--c-text)',
  fontSize: 14,
}

function btn(kind: 'primary' | 'ghost'): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    cursor: 'pointer',
    border: '1px solid ' + (kind === 'primary' ? 'var(--c-amber)' : 'var(--c-border)'),
    background: kind === 'primary' ? 'var(--c-amber)' : 'transparent',
    color: kind === 'primary' ? '#0D0B09' : 'var(--c-text)',
  }
}

const legBtn: React.CSSProperties = {
  width: 20, height: 20, padding: 0, fontSize: 11, lineHeight: '18px',
  border: '1px solid var(--c-border)', borderRadius: 4, background: 'var(--c-panel)', color: 'var(--c-text-mid)', cursor: 'pointer',
}

const legBtnWide: React.CSSProperties = {
  padding: '3px 8px', fontSize: 11, border: '1px solid var(--c-border)', borderRadius: 4,
  background: 'var(--c-panel)', color: 'var(--c-text-mid)', cursor: 'pointer',
}
