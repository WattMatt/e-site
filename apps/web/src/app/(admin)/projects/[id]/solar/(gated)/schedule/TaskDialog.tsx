'use client'
/**
 * Add / edit a task or milestone (spec §14.1). Every field stays editable after
 * creation (WM could not), split bars are edited here (split at a date, move a
 * segment's dates, join — WM's segments could not be edited at all, D6).
 * Dates stay 'YYYY-MM-DD' strings end to end — never a Date.
 *
 * Owners (owner decision Q4): the picker lists ONLY `owners`, the loader's
 * Solar-eligible list. A current owner who is no longer eligible is shown as a
 * disabled option so the bar's name is explained, but they cannot be chosen.
 */
import { useState } from 'react'
import {
  GANTT_STATUSES, GANTT_STATUS_LABELS, endForDuration, fitSegments, formatCalendarDate, isCalendarDate, spanDays, splitSegmentsAt,
  type CalendarDate, type GanttStatus, type ScheduleSegment, type ScheduleTaskView, type WorkCalendar,
} from '@esite/shared'
import type { TaskInput, TaskPatch } from '@/lib/solar/schedule/inputs'
import type { ScheduleOwner } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export const SCHEDULE_COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280'] as const

export type TaskDialogResult = { input: TaskInput } | { patch: TaskPatch }

export interface TaskDialogProps {
  mode: 'task' | 'milestone'
  initial: ScheduleTaskView | null
  /** Solar-eligible people only (ScheduleData.owners). */
  owners: ScheduleOwner[]
  cal: WorkCalendar
  canEdit: boolean
  defaultStart: CalendarDate
  /** Resolves to null on success (the dialog closes) or a sentence to show. */
  onSubmit: (r: TaskDialogResult) => Promise<string | null>
  onDelete?: (id: string) => void
  /** The signed-in user (ScheduleData.currentUserId): the Sign off button is theirs only if they are the gatekeeper. */
  viewerId?: string
  /** Sign off a task awaiting sign-off (status done → the work item closes). Resolves like onSubmit. */
  onSignOff?: (patch: TaskPatch) => Promise<string | null>
  onClose: () => void
}

const OVERLAY = { position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 } as const
const PANEL = {
  background: 'var(--c-surface)', border: '1px solid var(--c-border)', padding: 16, borderRadius: 8, width: 520,
  maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', overflow: 'auto', fontSize: 13, display: 'grid', gap: 8,
} as const

export function TaskDialog({ mode, initial, owners, cal, canEdit, defaultStart, onSubmit, onDelete, viewerId, onSignOff, onClose }: TaskDialogProps) {
  const milestone = mode === 'milestone'
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [zone, setZone] = useState(initial?.zone ?? '')
  const [start, setStart] = useState<string>(initial?.start ?? defaultStart)
  const [end, setEnd] = useState<string>(initial?.end ?? defaultStart)
  const [byDuration, setByDuration] = useState(false)
  const [duration, setDuration] = useState(initial ? String(Math.max(1, spanDays(cal, initial.start, initial.end))) : '1')
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? '')
  const [status, setStatus] = useState<GanttStatus>(initial?.status ?? 'not_started')
  const [progress, setProgress] = useState(String(initial?.progress ?? 0))
  const [colour, setColour] = useState(initial?.colour ?? SCHEDULE_COLOURS[0])
  const [description, setDescription] = useState(initial?.description ?? '')
  const [segments, setSegments] = useState<ScheduleSegment[]>(initial?.segments.map((s) => ({ start: s.start, end: s.end })) ?? [])
  const [splitAt, setSplitAt] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const del = useArmedConfirm()

  const split = segments.length >= 2
  const durationEnd = (): string | null => {
    const d = Number(duration)
    return isCalendarDate(start) && Number.isInteger(d) && d >= 1 ? endForDuration(cal, start, d) : null
  }
  const effectiveEnd = milestone ? start : split ? segments[segments.length - 1].end : byDuration ? durationEnd() ?? '' : end
  const effectiveStart = !milestone && split ? segments[0].start : start
  const ineligibleOwner = initial && initial.ownerId && !owners.some((o) => o.id === initial.ownerId) ? initial : null

  async function save() {
    const errs: string[] = []
    if (!name.trim()) errs.push(milestone ? 'Give the milestone a name.' : 'Give the task a name.')
    if (!isCalendarDate(effectiveStart)) errs.push(milestone ? 'Choose a date.' : 'Choose a start date.')
    if (!milestone && !isCalendarDate(effectiveEnd)) errs.push(byDuration ? 'The duration must be a whole number of days, at least 1.' : 'Choose an end date.')
    if (isCalendarDate(effectiveStart) && isCalendarDate(effectiveEnd) && effectiveEnd < effectiveStart) errs.push('The end date is before the start date.')
    const pct = Number(progress)
    if (!milestone && (progress.trim() === '' || !Number.isInteger(pct) || pct < 0 || pct > 100)) errs.push('Progress is a whole number from 0 to 100.')
    for (let i = 0; i < segments.length; i++) {
      if (!isCalendarDate(segments[i].start) || !isCalendarDate(segments[i].end) || segments[i].end < segments[i].start) {
        errs.push('Every segment needs a start and an end, in that order.')
        break
      }
    }
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].start <= segments[i - 1].end) { errs.push('Segments must not overlap.'); break }
    }
    setErrors(errs)
    if (errs.length) return

    let result: TaskDialogResult
    if (!initial) {
      result = { input: {
        key: 'new', name: name.trim(), start: effectiveStart, end: milestone ? effectiveStart : effectiveEnd, isMilestone: milestone,
        category: category.trim(), zone: zone.trim(), ownerId: ownerId || null, status: milestone ? 'not_started' : status,
        progress: milestone ? 0 : pct, colour, description,
      } }
    } else {
      const patch: TaskPatch = { id: initial.id, expectedUpdatedAt: initial.updatedAt }
      if (name.trim() !== initial.name) patch.name = name.trim()
      if (category.trim() !== initial.category) patch.category = category.trim()
      if (zone.trim() !== initial.zone) patch.zone = zone.trim()
      const segChanged = JSON.stringify(segments) !== JSON.stringify(initial.segments.map((s) => ({ start: s.start, end: s.end })))
      const newEnd = milestone ? effectiveStart : effectiveEnd
      if (segChanged) patch.segments = split ? segments : []
      if (!segChanged || !split) {
        if (effectiveStart !== initial.start || newEnd !== initial.end) {
          patch.start = effectiveStart
          patch.end = newEnd
          if (!segChanged && initial.segments.length >= 2) patch.segments = fitSegments(initial.segments, initial, { start: effectiveStart, end: newEnd })
        }
      }
      if (ownerId && ownerId !== initial.ownerId) patch.ownerId = ownerId
      if (!milestone && status !== initial.status) patch.status = status
      if (!milestone && pct !== initial.progress) patch.progress = pct
      if (colour !== initial.colour) patch.colour = colour
      if (description !== initial.description) patch.description = description
      if (Object.keys(patch).length === 2) { onClose(); return }
      result = { patch }
    }
    setBusy(true)
    const err = await onSubmit(result)
    setBusy(false)
    if (err) setErrors([err])
    else onClose()
  }

  // The status select already reads "Done" for a task awaiting sign-off, so Save
  // would send nothing: the gatekeeper needs an explicit action.
  const canSignOff = canEdit && !!initial && initial.awaitingSignOff && !!viewerId && initial.gatekeeperId === viewerId && !!onSignOff
  async function signOff() {
    if (!initial || !onSignOff) return
    setBusy(true)
    const err = await onSignOff({ id: initial.id, expectedUpdatedAt: initial.updatedAt, status: 'done' })
    setBusy(false)
    if (err) setErrors([err])
    else onClose()
  }

  const ro = !canEdit
  const noun = milestone ? 'milestone' : 'task'
  return (
    <div role="dialog" aria-modal="true" aria-label={initial ? `Edit ${noun}` : `Add ${noun}`} style={OVERLAY}>
      <div style={PANEL}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{initial ? `${initial.ref} — ${initial.name}` : milestone ? 'Add milestone' : 'Add task'}</h2>
        <label>Name <input disabled={ro} value={name} maxLength={300} onChange={(e) => setName(e.target.value)} /></label>
        {!milestone && (
          <>
            <label>Category <input disabled={ro} value={category} maxLength={120} onChange={(e) => setCategory(e.target.value)} /></label>
            <label>Zone <input disabled={ro} value={zone} maxLength={120} onChange={(e) => setZone(e.target.value)} /></label>
          </>
        )}
        <label>{milestone ? 'Date' : 'Start'} <input type="date" disabled={ro || split} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {!milestone && !split && (
          <>
            {canEdit && (
              <div role="radiogroup" aria-label="End by">
                <label><input type="radio" name="end-by" checked={!byDuration} onChange={() => setByDuration(false)} /> End date</label>{' '}
                <label><input type="radio" name="end-by" checked={byDuration} onChange={() => setByDuration(true)} /> Duration</label>
              </div>
            )}
            {byDuration ? (
              <div>
                <input type="number" aria-label="Duration (days)" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
                {durationEnd() && <span style={{ marginLeft: 8 }}>{`Ends ${formatCalendarDate(durationEnd() as string)}`}</span>}
              </div>
            ) : (
              <label>End <input type="date" disabled={ro} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            )}
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Counted in {cal.mode === 'working' ? 'working days' : 'calendar days'}.</div>
          </>
        )}
        {!milestone && (
          <>
            <label>Owner{' '}
              <select aria-label="Owner" disabled={ro} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {!initial && <option value="">Assign automatically (the project’s default owner)</option>}
                {ineligibleOwner && <option value={ineligibleOwner.ownerId} disabled>{`${ineligibleOwner.ownerName} (cannot own solar tasks)`}</option>}
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label>Status{' '}
              <select aria-label="Status" disabled={ro} value={status} onChange={(e) => setStatus(e.target.value as GanttStatus)}>
                {GANTT_STATUSES.map((s) => <option key={s} value={s}>{GANTT_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
            {initial?.awaitingSignOff && (
              <div style={{ color: 'var(--c-amber)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{canSignOff ? 'Done — awaiting your sign-off. A sign-off cannot be undone.' : 'Done — awaiting sign-off by the person who scheduled it.'}</span>
                {canSignOff && <button type="button" disabled={busy} onClick={() => void signOff()}>Sign off</button>}
              </div>
            )}
            <label>Progress % <input type="number" min={0} max={100} step={5} disabled={ro} value={progress} onChange={(e) => setProgress(e.target.value)} /></label>
          </>
        )}
        <label>Colour{' '}
          <select aria-label="Colour" disabled={ro} value={colour} onChange={(e) => setColour(e.target.value)}>
            {[...new Set([colour, ...SCHEDULE_COLOURS])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>{milestone ? 'Description' : 'Notes'} <textarea disabled={ro} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></label>

        {!milestone && initial && (canEdit || split) && (
          <fieldset>
            <legend>Split bar</legend>
            {split && segments.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <label>{`Segment ${i + 1} start`} <input type="date" disabled={ro} value={s.start}
                  onChange={(e) => setSegments((ss) => ss.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} /></label>
                <label>{`Segment ${i + 1} end`} <input type="date" disabled={ro} value={s.end}
                  onChange={(e) => setSegments((ss) => ss.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} /></label>
              </div>
            ))}
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <label>Split at <input type="date" value={splitAt} onChange={(e) => setSplitAt(e.target.value)} /></label>
                <button type="button" onClick={() => {
                  const next = isCalendarDate(splitAt) && isCalendarDate(effectiveStart) && isCalendarDate(effectiveEnd)
                    ? splitSegmentsAt({ start: effectiveStart, end: effectiveEnd }, segments, splitAt)
                    : null
                  if (next) { setSegments(next); setErrors([]) } else setErrors(['Choose a date inside the task, after its first day.'])
                }}>Split</button>
                {split && <button type="button" onClick={() => setSegments([])}>Join segments</button>}
              </div>
            )}
          </fieldset>
        )}

        {errors.length > 0 && <ul role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {canEdit && initial && onDelete && (del.armed
            ? <button type="button" onClick={() => { del.disarm(); onDelete(initial.id) }}>Confirm delete</button>
            : <button type="button" onClick={del.arm}>{milestone ? 'Delete milestone' : 'Delete task'}</button>)}
          <button type="button" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && <button type="button" className="btn-primary-amber" disabled={busy} onClick={() => void save()}>Save</button>}
        </div>
      </div>
    </div>
  )
}
