'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { routeTotalM, isSegmentCalibrationStale } from '@esite/shared'
import {
  saveSupplyRouteAction,
  applyRouteToScheduleAction,
  deleteSupplyRouteAction,
} from '@/actions/cable-route.actions'

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
  const [selectedId, setSelectedId] = useState<string | null>(initialSupplyId ?? null)
  /** Which sheet "Trace on drawing" opens. Defaults to the last sheet used. */
  const [tracePlanId, setTracePlanId] = useState<string>(() => {
    const legs = initialRun?.route?.segments ?? []
    return legs.length ? (legs[legs.length - 1].floorPlanId ?? '') : ''
  })
  const [riseM, setRiseM] = useState(initialRun?.route?.riseM ?? 0)
  const [dropM, setDropM] = useState(initialRun?.route?.dropM ?? 0)
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ existingM: number; proposedM: number } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans])

  const selected = runs.find((r) => r.supplyId === selectedId) ?? null

  const visible = useMemo(() => {
    const traced = (r: RunRow) => !!r.route && r.route.segments.length > 0
    if (filter === 'outstanding') return runs.filter((r) => !traced(r))
    if (filter === 'traced') return runs.filter(traced)
    return runs
  }, [runs, filter])

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

  /** Totals from the same shared maths the server uses. */
  const liveTotal = useMemo(
    () => routeTotalM({ segments: savedSegments.map((s) => ({ length_m: s.lengthM })), riseM, dropM }),
    [savedSegments, riseM, dropM],
  )
  const liveTraced = useMemo(
    () => routeTotalM({ segments: savedSegments.map((s) => ({ length_m: s.lengthM })), riseM: 0, dropM: 0 }),
    [savedSegments],
  )

  const selectRun = useCallback(
    (run: RunRow) => {
      setSelectedId(run.supplyId)
      setMessage(null)
      setConfirming(null)
      setRiseM(run.route?.riseM ?? 0)
      setDropM(run.route?.dropM ?? 0)
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

  const save = useCallback(() => {
    if (!selected) return
    setMessage(null)
    startTransition(async () => {
      const res = await saveSupplyRouteAction({
        supplyId: selected.supplyId,
        riseM,
        dropM,
        // Resent unchanged. A leg whose drawing was deleted has a null
        // floor_plan_id and cannot be resent, so saving would silently shorten
        // the run — `save` is disabled in that state rather than dropping it.
        segments: savedSegments
          .filter((s) => s.floorPlanId)
          .map((s) => ({
            floorPlanId: s.floorPlanId as string,
            pageIndex: s.pageIndex,
            points: s.points,
          })),
      })
      if (res.error) {
        setMessage(res.error)
        return
      }
      // The server's figure wins on screen. The client's live total is an aid
      // while tracing; it is not the number that was stored.
      setMessage(`Route saved — ${res.totalM?.toFixed(2)} m (traced ${res.tracedM?.toFixed(2)} m).`)
    })
  }, [selected, riseM, dropM, savedSegments])

  const apply = useCallback(
    (confirmOverwrite: boolean) => {
      if (!selected) return
      setMessage(null)
      startTransition(async () => {
        const res = await applyRouteToScheduleAction({
          supplyId: selected.supplyId,
          confirmOverwrite,
        })
        if (res.needsConfirmation) {
          setConfirming({
            existingM: res.needsConfirmation.existingM,
            proposedM: res.needsConfirmation.proposedM,
          })
          return
        }
        setConfirming(null)
        setMessage(
          res.error
            ? res.error
            : `Applied ${res.appliedM?.toFixed(2)} m to ${res.strands} strand${res.strands === 1 ? '' : 's'}.`,
        )
      })
    },
    [selected],
  )


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

            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: 'var(--c-surface)',
                border: '1px solid var(--c-border)',
                borderRadius: 10,
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              <label style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                Rise (m)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={riseM}
                  onChange={(e) => setRiseM(Math.max(0, Number(e.target.value) || 0))}
                  style={inputStyle}
                />
              </label>
              <label style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                Drop (m)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={dropM}
                  onChange={(e) => setDropM(Math.max(0, Number(e.target.value) || 0))}
                  style={inputStyle}
                />
              </label>

              <div style={{ fontSize: 13 }}>
                <div style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>
                  Traced {liveTraced.toFixed(2)} m + rise {riseM} + drop {dropM}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{liveTotal.toFixed(2)} m</div>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending || savedSegments.some((g) => !g.floorPlanId)}
                  style={btn('ghost')}
                  title={
                    savedSegments.some((g) => !g.floorPlanId)
                      ? 'A leg was traced on a drawing that no longer exists — saving would drop it. Remove the route and retrace.'
                      : 'Save the rise and drop against this route'
                  }
                >
                  Save rise &amp; drop
                </button>
                <button
                  type="button"
                  onClick={() => apply(false)}
                  disabled={pending || savedSegments.length === 0}
                  style={btn('primary')}
                >
                  Assign to schedule
                </button>
                {selected.route && (
                  <button type="button" onClick={removeRoute} disabled={pending} style={btn('ghost')}>
                    Remove route
                  </button>
                )}
              </div>
            </div>

            {confirming && (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--c-amber)',
                  background: 'color-mix(in srgb, var(--c-amber) 10%, transparent)',
                  fontSize: 13,
                }}
              >
                This run already has a length of <strong>{confirming.existingM} m</strong> on the
                schedule. The traced route gives <strong>{confirming.proposedM} m</strong>. Replacing
                it records both values in the change log.
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => apply(true)} disabled={pending} style={btn('primary')}>
                    Replace with {confirming.proposedM} m
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} style={btn('ghost')}>
                    Keep {confirming.existingM} m
                  </button>
                </div>
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
