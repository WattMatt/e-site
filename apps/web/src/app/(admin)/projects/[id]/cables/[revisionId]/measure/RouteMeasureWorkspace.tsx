'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { isSegmentCalibrationStale } from '@esite/shared'
import { deleteSupplyRouteAction } from '@/actions/cable-route.actions'
import { AssignRoutePanel } from '@/components/cable-route/AssignRoutePanel'

export interface PlanRow {
  id: string
  name: string
  isPdf: boolean
  filePath: string
  pixelsPerMeter: number | null
}

export interface RunSegment {
  id: string
  seq: number
  floorPlanId: string | null
  floorPlanName: string
  pageIndex: number
  points: number[]
  pixelsPerMeter: number
  lengthM: number
}

export interface RunRow {
  supplyId: string
  fromCode: string
  toCode: string
  voltageV: number
  section: string | null
  strands: number
  /** What the schedule currently says, if anything. */
  scheduleLengthM: number | null
  route: {
    riseM: number
    dropM: number
    tracedM: number
    totalM: number
    segments: RunSegment[]
  } | null
}

type Filter = 'outstanding' | 'traced' | 'all'

/**
 * The measuring session.
 *
 * Left: the worklist. Right: the drawing.
 *
 * The worklist defaults to OUTSTANDING and a run leaves it the moment its route
 * is saved. That is the narrowing the whole flow is built around: the list is
 * derived from whether a route exists, never maintained by hand, so it cannot
 * drift from the schedule.
 */
export function RouteMeasureWorkspace({
  projectId,
  revisionId,
  runs,
  plans,
  initialSupplyId,
}: {
  projectId: string
  revisionId: string
  runs: RunRow[]
  plans: PlanRow[]
  /** Preselect this run — set when arriving from the grid's "trace →" link or
   *  on returning from the drawing viewer. Already validated against `runs`. */
  initialSupplyId?: string
}) {
  const initialRun = initialSupplyId ? runs.find((r) => r.supplyId === initialSupplyId) : undefined
  // A deep-linked run must be visible, or the page would open on a list that
  // does not contain the thing the link named. An already-traced run is not on
  // the outstanding list, so widen the filter rather than silently drop it.
  const [filter, setFilter] = useState<Filter>(
    initialRun?.route && initialRun.route.segments.length > 0 ? 'all' : 'outstanding',
  )
  /** Search and sort — KINGSWALK has 125 runs on one revision. */
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'length' | 'status'>('name')
  const [selectedId, setSelectedId] = useState<string | null>(initialSupplyId ?? null)
  /** Which sheet "Trace on drawing" opens. Defaults to the last sheet used. */
  const [tracePlanId, setTracePlanId] = useState<string>(() => {
    const legs = initialRun?.route?.segments ?? []
    return legs.length ? (legs[legs.length - 1].floorPlanId ?? '') : ''
  })
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans])

  const selected = runs.find((r) => r.supplyId === selectedId) ?? null

  const visible = useMemo(() => {
    const traced = (r: RunRow) => !!r.route && r.route.segments.length > 0
    let list = filter === 'outstanding' ? runs.filter((r) => !traced(r)) : filter === 'traced' ? runs.filter(traced) : runs
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
  }, [runs, filter, query, sort])

  /** Every run with its route figures, as a file the schedule people can keep. */
  const downloadCsv = useCallback(() => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['From', 'To', 'Section', 'Strands', 'Legs', 'Sheets', 'Traced (m)', 'Rise (m)', 'Drop (m)', 'Route total (m)', 'Schedule length (m)', 'On schedule'],
      ...runs.map((r) => [
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
  }, [runs, revisionId])

  const outstandingCount = runs.filter((r) => !r.route || r.route.segments.length === 0).length

  /**
   * The legs as PERSISTED. Tracing happens on the drawing viewer and saves as
   * it goes, so the workspace never holds an unsaved copy of the geometry.
   *
   * That is deliberate: the shipped version enabled "Assign to schedule" from
   * on-screen state while the action read the STORED route, so tracing and then
   * assigning without saving returned "This run has no measured route yet."
   * With one source of truth the two cannot disagree.
   */
  const savedSegments = selected?.route?.segments ?? []

  const selectRun = useCallback(
    (run: RunRow) => {
      setSelectedId(run.supplyId)
      setMessage(null)
      // Continue on the sheet this run was last traced on; otherwise leave the
      // picker empty so choosing a sheet is a deliberate act.
      const legs = run.route?.segments ?? []
      setTracePlanId(legs.length ? (legs[legs.length - 1].floorPlanId ?? '') : '')
    },
    [],
  )

  /** Hand off to the drawing viewer in route mode. */
  const traceOnDrawing = useCallback(() => {
    if (!selected || !tracePlanId) return
    router.push(
      `/projects/${projectId}/floor-plans/${tracePlanId}?mode=route&supply=${selected.supplyId}`,
    )
  }, [router, projectId, selected, tracePlanId])

  const removeRoute = useCallback(() => {
    if (!selected) return
    startTransition(async () => {
      const res = await deleteSupplyRouteAction({ supplyId: selected.supplyId })
      setMessage(res.error ?? 'Route removed. The run is back on the outstanding list.')
      if (!res.error) router.refresh()
    })
  }, [selected])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* ── Worklist ─────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid var(--c-border)' }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search runs…"
            aria-label="Search runs"
            style={{ ...inputStyle, width: '100%', marginBottom: 6 }}
          />
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
          {(['outstanding', 'traced', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 12,
                borderRadius: 6,
                textTransform: 'capitalize',
                cursor: 'pointer',
                border: '1px solid ' + (filter === f ? 'var(--c-amber)' : 'var(--c-border)'),
                background: filter === f ? 'var(--c-amber)' : 'transparent',
                color: filter === f ? '#0D0B09' : 'var(--c-text)',
              }}
            >
              {f}
              {f === 'outstanding' ? ` (${outstandingCount})` : ''}
            </button>
          ))}
        </div>

        <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          {visible.length === 0 && (
            <p style={{ padding: 16, margin: 0, fontSize: 13, color: 'var(--c-text-dim)' }}>
              {filter === 'outstanding'
                ? 'Every run on this revision has a traced route.'
                : 'Nothing here yet.'}
            </p>
          )}
          {visible.map((r) => {
            const isSel = r.supplyId === selectedId
            const traced = !!r.route && r.route.segments.length > 0
            const stale =
              r.route?.segments.some((s) =>
                isSegmentCalibrationStale(
                  { pixels_per_meter: s.pixelsPerMeter },
                  s.floorPlanId ? planById.get(s.floorPlanId)?.pixelsPerMeter ?? null : null,
                ),
              ) ?? false
            return (
              <button
                key={r.supplyId}
                type="button"
                onClick={() => selectRun(r)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderBottom: '1px solid var(--c-border)',
                  background: isSel ? 'var(--c-surface-2)' : 'transparent',
                  cursor: 'pointer',
                  color: 'var(--c-text)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.fromCode} → {r.toCode}
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 2 }}>
                  {r.voltageV} V · {r.strands} strand{r.strands === 1 ? '' : 's'}
                  {r.scheduleLengthM != null && ` · schedule ${r.scheduleLengthM} m`}
                </div>
                {traced && (
                  <div style={{ fontSize: 11, marginTop: 3, color: stale ? 'var(--c-amber)' : 'var(--c-green, #34D399)' }}>
                    {stale ? '⚠ drawing recalibrated since tracing' : `traced ${r.route!.totalM} m`}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Canvas + controls ────────────────────────────────────── */}
      <div>
        {!selected && (
          <div
            style={{
              border: '1px dashed var(--c-border)',
              borderRadius: 10,
              padding: 48,
              textAlign: 'center',
              color: 'var(--c-text-dim)',
              fontSize: 14,
            }}
          >
            Pick a run from the list to start measuring.
          </div>
        )}

        {selected && (
          <>
            <div
              style={{
                padding: 14,
                background: 'var(--c-surface)',
                border: '1px solid var(--c-border)',
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
                {selected.fromCode} → {selected.toCode}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                {savedSegments.length === 0
                  ? 'Not traced yet. Pick the sheet this run starts on.'
                  : `${savedSegments.length} leg${savedSegments.length === 1 ? '' : 's'} traced. Open a sheet to add another or retrace.`}
              </div>

              {savedSegments.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {savedSegments.map((g, i) => {
                    const plan = g.floorPlanId ? planById.get(g.floorPlanId) : undefined
                    const stale = isSegmentCalibrationStale(
                      { pixels_per_meter: g.pixelsPerMeter },
                      plan?.pixelsPerMeter ?? null,
                    )
                    return (
                      <div
                        key={g.id}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'baseline',
                          padding: '5px 0',
                          borderBottom: '1px solid var(--c-border)',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: 'var(--c-text-dim)', minWidth: 16 }}>{i + 1}.</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {g.floorPlanName}
                          <span style={{ color: 'var(--c-text-dim)' }}> · page {g.pageIndex}</span>
                          {!g.floorPlanId && (
                            <span style={{ color: 'var(--c-amber)' }}> · drawing no longer available</span>
                          )}
                          {stale && (
                            <span style={{ color: 'var(--c-amber)' }}> · sheet re-scaled since tracing</span>
                          )}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{g.lengthM.toFixed(2)} m</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {plans.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-dim)' }}>
                  This project has no drawings loaded, so there is nothing to trace a route on.
                  Upload the power layouts under Floor Plans first.
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    value={tracePlanId}
                    onChange={(e) => setTracePlanId(e.target.value)}
                    style={{ ...inputStyle, minWidth: 280, marginTop: 0 }}
                    aria-label="Drawing to trace on"
                  >
                    <option value="">Choose a sheet…</option>
                    {plans.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                        {pl.pixelsPerMeter ? '' : ' (no scale yet)'}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={traceOnDrawing} disabled={!tracePlanId} style={btn('primary')}>
                    Trace on drawing →
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                    Opens the drawing viewer. A sheet with no scale is calibrated there, once.
                  </span>
                </div>
              )}
            </div>

            {/* Rise & drop and Assign — the same component the drawing viewer
                mounts, so there is exactly one assign surface and one overwrite
                confirmation. Keyed on the run so its inputs reset per run. */}
            <div style={{ marginTop: 12 }}>
              <AssignRoutePanel
                key={selected.supplyId}
                supplyId={selected.supplyId}
                segments={savedSegments}
                initialRiseM={selected.route?.riseM ?? 0}
                initialDropM={selected.route?.dropM ?? 0}
                scheduleLengthM={selected.scheduleLengthM}
                strands={selected.strands}
                onChanged={() => router.refresh()}
              />
            </div>
            {selected.route && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" onClick={removeRoute} disabled={pending} style={btn('ghost')}>
                  Remove route
                </button>
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                  Deletes the traced legs. The schedule keeps whatever length it holds.
                </span>
              </div>
            )}
            {message && (
              <p style={{ marginTop: 10, fontSize: 13, color: 'var(--c-text-dim)' }}>{message}</p>
            )}
          </>
        )}
      </div>
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
