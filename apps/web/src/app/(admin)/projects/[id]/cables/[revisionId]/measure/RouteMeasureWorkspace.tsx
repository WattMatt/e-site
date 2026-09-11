'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { routeTotalM, isSegmentCalibrationStale } from '@esite/shared'
import {
  saveSupplyRouteAction,
  applyRouteToScheduleAction,
  deleteSupplyRouteAction,
} from '@/actions/cable-route.actions'
import { RouteCanvas, type TracedSegment, type SheetLegendRow } from './RouteCanvas'

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
}: {
  projectId: string
  revisionId: string
  runs: RunRow[]
  plans: PlanRow[]
}) {
  const [filter, setFilter] = useState<Filter>('outstanding')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [segments, setSegments] = useState<TracedSegment[]>([])
  const [riseM, setRiseM] = useState(0)
  const [dropM, setDropM] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ existingM: number; proposedM: number } | null>(null)
  const [pending, startTransition] = useTransition()

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans])

  const selected = runs.find((r) => r.supplyId === selectedId) ?? null

  const visible = useMemo(() => {
    const traced = (r: RunRow) => !!r.route && r.route.segments.length > 0
    if (filter === 'outstanding') return runs.filter((r) => !traced(r))
    if (filter === 'traced') return runs.filter(traced)
    return runs
  }, [runs, filter])

  const outstandingCount = runs.filter((r) => !r.route || r.route.segments.length === 0).length

  /** Live total while tracing, from the same shared maths the server uses. */
  const liveTotal = useMemo(
    () => routeTotalM({ segments: segments.map((s) => ({ length_m: s.lengthM })), riseM, dropM }),
    [segments, riseM, dropM],
  )
  const liveTraced = useMemo(
    () => routeTotalM({ segments: segments.map((s) => ({ length_m: s.lengthM })), riseM: 0, dropM: 0 }),
    [segments],
  )

  const selectRun = useCallback(
    (run: RunRow) => {
      setSelectedId(run.supplyId)
      setMessage(null)
      setConfirming(null)
      setRiseM(run.route?.riseM ?? 0)
      setDropM(run.route?.dropM ?? 0)
      setSegments(
        (run.route?.segments ?? [])
          .filter((s) => s.floorPlanId)
          .map((s) => ({
            floorPlanId: s.floorPlanId!,
            floorPlanName: s.floorPlanName,
            pageIndex: s.pageIndex,
            points: s.points,
            pixelsPerMeter: s.pixelsPerMeter,
            lengthM: s.lengthM,
          })),
      )
    },
    [],
  )

  const save = useCallback(() => {
    if (!selected) return
    setMessage(null)
    startTransition(async () => {
      const res = await saveSupplyRouteAction({
        supplyId: selected.supplyId,
        riseM,
        dropM,
        segments: segments.map((s) => ({
          floorPlanId: s.floorPlanId,
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
  }, [selected, riseM, dropM, segments])

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

  /**
   * The condensed schedule for one sheet: every SAVED run with a leg on it.
   *
   * It reads saved routes, not the run being traced, so an exported sheet shows
   * what the schedule actually holds. A half-traced route on screen is not yet
   * a fact about the job and must not print as one.
   *
   * `continuesElsewhere` is the honest half: a run whose route crosses sheets
   * shows both the metres traced here and the run total, so nobody reads the
   * total as the length of the line drawn on the page in front of them.
   */
  const legendFor = useCallback(
    (planId: string, pageIndex: number): SheetLegendRow[] =>
      runs
        .filter((r) => r.route && r.route.segments.length > 0)
        .map((r) => {
          const legs = r.route!.segments
          const here = legs.filter((s) => s.floorPlanId === planId && s.pageIndex === pageIndex)
          if (here.length === 0) return null
          const onSheetM = here.reduce((a, s) => a + s.lengthM, 0)
          return {
            label: `${r.fromCode} → ${r.toCode}`,
            totalM: r.route!.totalM,
            onSheetM,
            continuesElsewhere: here.length !== legs.length,
          }
        })
        .filter((x): x is SheetLegendRow => x !== null)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [runs],
  )

  const removeRoute = useCallback(() => {
    if (!selected) return
    startTransition(async () => {
      const res = await deleteSupplyRouteAction({ supplyId: selected.supplyId })
      setMessage(res.error ?? 'Route removed. The run is back on the outstanding list.')
      if (!res.error) setSegments([])
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
            <RouteCanvas
              projectId={projectId}
              plans={plans}
              segments={segments}
              onSegmentsChange={setSegments}
              runLabel={`${selected.fromCode} → ${selected.toCode}`}
              legendFor={legendFor}
            />

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
                <button type="button" onClick={save} disabled={pending} style={btn('ghost')}>
                  Save route
                </button>
                <button
                  type="button"
                  onClick={() => apply(false)}
                  disabled={pending || segments.length === 0}
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
