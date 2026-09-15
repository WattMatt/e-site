'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { routeTotalM } from '@esite/shared'
import { saveSupplyRouteAction, applyRouteToScheduleAction, revertRouteAssignmentAction } from '@/actions/cable-route.actions'

/**
 * Rise & drop, the run total, and ASSIGN TO SCHEDULE — one component, mounted
 * on the drawing (route mode) and on the measure worklist.
 *
 * One component on purpose. Assigning is the irreversible write in this flow
 * (every strand's measured_length_m, method SCALE_RULE, a change-log row), and
 * it carries an overwrite confirmation. Two hand-rolled copies of that
 * confirmation is how one of them ends up showing the wrong number — the first
 * cut showed only the LOWEST existing strand length even when parallels
 * disagreed. This one lists every distinct value the action reports.
 *
 * Measuring is not assigning: saving rise & drop touches the route only.
 */

export interface AssignPanelSegment {
  id: string
  /** NULL when the drawing was deleted after tracing — such a leg cannot be resent. */
  floorPlanId: string | null
  pageIndex: number
  points: number[]
  lengthM: number
}

type Props = {
  supplyId: string
  segments: AssignPanelSegment[]
  initialRiseM: number
  initialDropM: number
  /** What the schedule holds for this run right now, if anything (any strand). */
  scheduleLengthM: number | null
  strands: number
  /** Called after any write so the host can refresh what it shows. */
  onChanged?: () => void
  /** Stacked layout for a narrow rail. */
  compact?: boolean
}

export function AssignRoutePanel({
  supplyId, segments, initialRiseM, initialDropM, scheduleLengthM, strands, onChanged, compact,
}: Props) {
  const [riseM, setRiseM] = useState(initialRiseM)
  const [dropM, setDropM] = useState(initialDropM)
  // The route can change underneath the panel — a restore from history, an
  // undo, another tab's save arriving via refresh. Follow it, or the inputs
  // show a figure the route no longer holds.
  useEffect(() => { setRiseM(initialRiseM) }, [initialRiseM])
  useEffect(() => { setDropM(initialDropM) }, [initialDropM])
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ existingValuesM: number[]; proposedM: number; strands: number } | null>(null)
  const [pending, startTransition] = useTransition()

  const traced = useMemo(
    () => routeTotalM({ segments: segments.map((s) => ({ length_m: s.lengthM })), riseM: 0, dropM: 0 }),
    [segments],
  )
  const total = useMemo(
    () => routeTotalM({ segments: segments.map((s) => ({ length_m: s.lengthM })), riseM, dropM }),
    [segments, riseM, dropM],
  )
  const orphaned = segments.some((s) => !s.floorPlanId)
  const dirty = riseM !== initialRiseM || dropM !== initialDropM

  // Where this run stands on the schedule, in one line.
  const onSchedule =
    scheduleLengthM != null && segments.length > 0 && Math.abs(scheduleLengthM - total) < 0.005
  const status =
    segments.length === 0
      ? 'Nothing traced yet.'
      : onSchedule
        ? `On the schedule at ${scheduleLengthM!.toFixed(2)} m — matches this route.`
        : scheduleLengthM == null
          ? 'Not on the schedule yet.'
          : `Schedule holds ${scheduleLengthM.toFixed(2)} m; this route gives ${total.toFixed(2)} m.`

  function saveRiseDrop() {
    setMessage(null)
    startTransition(async () => {
      const res = await saveSupplyRouteAction({
        supplyId,
        riseM,
        dropM,
        // The action replaces the whole list, so the legs are resent unchanged.
        segments: segments
          .filter((s) => s.floorPlanId)
          .map((s) => ({ floorPlanId: s.floorPlanId as string, pageIndex: s.pageIndex, points: s.points })),
      })
      if (res.error) { setMessage(res.error); return }
      setMessage(`Saved — ${res.totalM?.toFixed(2)} m (traced ${res.tracedM?.toFixed(2)} m + rise ${riseM} + drop ${dropM}).`)
      onChanged?.()
    })
  }

  function assign(confirmOverwrite: boolean) {
    setMessage(null)
    startTransition(async () => {
      // Unsaved rise/drop would make the assigned figure differ from the one
      // on screen. Save first, in the same click.
      if (dirty) {
        const saved = await saveSupplyRouteAction({
          supplyId, riseM, dropM,
          segments: segments.filter((s) => s.floorPlanId).map((s) => ({ floorPlanId: s.floorPlanId as string, pageIndex: s.pageIndex, points: s.points })),
        })
        if (saved.error) { setMessage(saved.error); return }
      }
      const res = await applyRouteToScheduleAction({ supplyId, confirmOverwrite })
      if (res.needsConfirmation) {
        setConfirming({
          existingValuesM: res.needsConfirmation.existingValuesM ?? [res.needsConfirmation.existingM],
          proposedM: res.needsConfirmation.proposedM,
          strands: res.needsConfirmation.strands,
        })
        return
      }
      setConfirming(null)
      if (res.error) { setMessage(res.error); return }
      setMessage(`Assigned ${res.appliedM?.toFixed(2)} m to ${res.strands} strand${res.strands === 1 ? '' : 's'} — method SCALE_RULE, recorded in the change log.`)
      onChanged?.()
    })
  }

  function revert() {
    setMessage(null)
    startTransition(async () => {
      const res = await revertRouteAssignmentAction({ supplyId })
      if (res.error) { setMessage(res.error); return }
      setMessage(`Reverted ${res.strands} strand${res.strands === 1 ? '' : 's'} to ${res.revertedToM == null ? 'no length' : `${res.revertedToM.toFixed(2)} m`} — recorded in the change log.`)
      onChanged?.()
    })
  }

  const row: React.CSSProperties = compact
    ? { display: 'flex', flexDirection: 'column', gap: 10 }
    : { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }

  return (
    <div style={{ padding: 12, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10 }}>
      <div style={{ fontSize: 12, color: onSchedule ? 'var(--c-success, #15803d)' : 'var(--c-text-dim)', marginBottom: 10 }}>
        {status}
      </div>
      <div style={row}>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Rise (m)
            <input type="number" min={0} step={0.1} value={riseM} onChange={(e) => setRiseM(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} aria-label="Rise in metres" />
          </label>
          <label style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Drop (m)
            <input type="number" min={0} step={0.1} value={dropM} onChange={(e) => setDropM(Math.max(0, Number(e.target.value) || 0))} style={inputStyle} aria-label="Drop in metres" />
          </label>
        </div>
        <div style={{ fontSize: 13 }}>
          <div style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>
            Traced {traced.toFixed(2)} m + rise {riseM} + drop {dropM}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{total.toFixed(2)} m</div>
        </div>
        <div style={{ marginLeft: compact ? 0 : 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={saveRiseDrop}
            disabled={pending || orphaned || !dirty}
            style={btn('ghost')}
            title={orphaned ? 'A leg was traced on a drawing that no longer exists — saving would drop it. Remove the route and retrace.' : 'Save rise and drop against this route'}
          >
            Save rise &amp; drop
          </button>
          <button
            type="button"
            onClick={() => assign(false)}
            disabled={pending || orphaned || segments.length === 0}
            style={btn('primary')}
            title="Write this total to every strand of the run on the cable schedule"
          >
            {pending ? 'Working…' : 'Assign to schedule'}
          </button>
          {onSchedule && (
            <button
              type="button"
              onClick={revert}
              disabled={pending}
              style={btn('ghost')}
              title="Put the schedule back to the length it held before this route was assigned (recorded in the change log)"
            >
              Revert to previous length
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div
          role="alertdialog"
          style={{ marginTop: 10, padding: 12, borderRadius: 10, border: '1px solid var(--c-amber)', background: 'color-mix(in srgb, var(--c-amber) 10%, transparent)', fontSize: 13 }}
        >
          This run already has a length on the schedule:{' '}
          <strong>
            {confirming.existingValuesM.map((v) => `${v.toFixed(2)} m`).join(' / ')}
          </strong>
          {confirming.existingValuesM.length > 1 && ` across ${confirming.strands} strands`}.
          The traced route gives <strong>{confirming.proposedM.toFixed(2)} m</strong>. Replacing it records
          both values in the change log.
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => assign(true)} disabled={pending} style={btn('primary')}>
              Replace with {confirming.proposedM.toFixed(2)} m
            </button>
            <button type="button" onClick={() => setConfirming(null)} style={btn('ghost')}>
              Keep the schedule&apos;s figure
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" style={{ margin: '10px 0 0', fontSize: 12, color: /^(Assigned|Saved|Reverted)/.test(message) ? 'var(--c-text)' : '#dc2626' }}>
          {message}
        </p>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  width: 90,
  padding: '6px 8px',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
}

function btn(kind: 'primary' | 'ghost'): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: kind === 'primary' ? '1px solid var(--c-amber)' : '1px solid var(--c-border)',
    background: kind === 'primary' ? 'var(--c-amber)' : 'transparent',
    color: kind === 'primary' ? '#1a1a1a' : 'var(--c-text)',
  }
}
