/**
 * Plan an MS Project (MSPDI) import against the current programme state.
 *
 * Pure: `planImport(state, mspdi, newKey)` returns the `ProgrammeOp[]` that
 * `applyOps` / `programme.save_changes` apply in one transaction, a human diff
 * and warnings. Matching is by `external_uid` (the MS Project task UID).
 *
 * Rules (plan P4a Global Constraints):
 * - matched UIDs get an upsert carrying ONLY the writable fields that differ;
 *   new UIDs are created with `newKey()`; a UID that comes back after being
 *   tombstoned is restored on the same row, then updated.
 * - UIDs missing from the file get `delete_activity` (it tombstones, because
 *   `external_uid` is set). Children are deleted before their parents. A
 *   removed activity that still holds an E-Site activity cannot be deleted
 *   (save_changes refuses a parent with live children) and E-Site work is
 *   never moved by an import, so it is KEPT and listed in the warnings.
 * - activities with no `external_uid` (made in E-Site) are never named in an op.
 * - links whose two ends are both imported are replaced to match the file;
 *   a link touching an E-Site activity is left alone.
 * - `project_start` is set only on a first import (no activity has ever
 *   carried an external_uid) or when it is empty.
 * - calendars: the project calendar and every calendar a task uses are named
 *   "MS Project: <name>", so they never overwrite E-Site's seeded Site/Office
 *   calendars; a re-import reuses them by that name (case-insensitive). The
 *   project calendar becomes the programme default.
 * - parents are created before children (file order is outline order); a
 *   task kept under a skipped inactive summary goes under its nearest active
 *   ancestor, which the outline stack gives for free.
 * - an identical re-import produces no ops at all.
 * - progress recorded in E-Site is never wiped (ruling C1): for actual_start,
 *   actual_finish and percent_complete a silent file (null, or 0 % with no
 *   actuals) keeps E-Site's value; a file value wins, with a warning when
 *   E-Site had a different one. remaining_duration is never imported; E-Site's
 *   is kept unless the file changed the progress or the duration, when it is
 *   cleared (the engine then works it out from the actuals and data date) so a
 *   stale remaining cannot shorten the task.
 * - `<StatusDate>` sets the programme's data_date when present (diff.dataDate).
 * - a UID that comes back under a removed E-Site activity cannot be restored
 *   (restore_activity refuses while the parent is removed, and the import never
 *   names an E-Site activity), so it is left removed with a warning.
 *
 * Link lag calendar: `project`. MS Project computes link lag on the project
 * calendar by default (not the task calendar). OWED: confirm against a real
 * contractor file with mixed calendars.
 *
 * Diff counting:
 * - a link whose (pred, succ, type) survives but whose lag, lag_unit or
 *   lag_calendar differs is ONE in-place update, counted in `linksChanged`;
 * - `sort_order` follows file order and is always written, but a move alone
 *   is not a change: it is not listed in `changed[].fields`, and a row whose
 *   only difference is its sort_order counts as unchanged.
 */
import { dayNumber, fromDayNumber, type CalendarDate } from '../../lib/dates/calendar-date'
import type { ActivityType, LagCalendar } from '../types'
import type { ActivityFields, ProgrammeOp, ProgrammeState } from '../persistence/ops'
import type { ActivityRow, CalendarRow, DependencyRow } from '../persistence/rows'
import type { MspdiCalendar, MspdiProgramme, MspdiTask } from './mspdi-parse'

export interface ImportDiff {
  added: Array<{ uid: string; name: string }>
  changed: Array<{ uid: string; name: string; fields: string[] }>
  removed: Array<{ uid: string; name: string }>
  linksAdded: number
  linksRemoved: number
  linksChanged: number
  calendarChanged: boolean
  /** The data date the import sets from the file's StatusDate, or null when it stays. */
  dataDate: { from: string | null; to: string } | null
  unchanged: number
}
export interface ImportPlan {
  ops: ProgrammeOp[]
  diff: ImportDiff
  warnings: string[]
}

const NAME_MAX = 300
const CALENDAR_NAME_MAX = 80
const CALENDAR_PREFIX = 'MS Project: '
const LAG_CALENDAR: LagCalendar = 'project'
const MON_TO_FRI = [1, 2, 3, 4, 5]

/** The activity fields an import owns. Everything else (code, anchor, fixed dates, remaining duration) stays E-Site's. */
const IMPORT_FIELDS = [
  'parent_id', 'wbs_code', 'name', 'type', 'original_duration', 'calendar_id', 'constraint_type', 'constraint_date',
  'deadline', 'actual_start', 'actual_finish', 'percent_complete', 'remaining_duration', 'sort_order', 'external_uid',
] as const
const PROGRESS_LABEL = { actual_start: 'actual start', actual_finish: 'actual finish', percent_complete: 'percent complete' } as const
const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
type ImportField = (typeof IMPORT_FIELDS)[number]
type Desired = Record<ImportField, string | number | null>

/** NUMERIC(p,2) rounding, as `applyOps` stores numbers. */
const round2 = (n: number) => (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9)) / 100
const norm = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return round2(v)
  return String(v)
}
const cap = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s)
const label = (t: MspdiTask) => `Task "${t.name}" (UID ${t.uid})`

interface CalendarPlan {
  /** id of an existing row, or the key of a new one. */
  ref: string
  changed: boolean
}

export function planImport(state: ProgrammeState, m: MspdiProgramme, newKey: () => string): ImportPlan {
  const warnings: string[] = []
  const ops: ProgrammeOp[] = []
  const diff: ImportDiff = {
    added: [], changed: [], removed: [], linksAdded: 0, linksRemoved: 0, linksChanged: 0, calendarChanged: false, dataDate: null, unchanged: 0,
  }

  const byUid = new Map<string, ActivityRow>()
  for (const a of state.activities) if (a.external_uid !== null) byUid.set(a.external_uid, a)
  const firstImport = byUid.size === 0

  // ------------------------------------------------------------ calendars
  const calendarOps: ProgrammeOp[] = []
  const calendarRefs = new Map<string, CalendarPlan>() // file calendar uid → plan
  const fileCalendars = new Map(m.calendars.map((c) => [c.uid, c]))
  const usedUids: string[] = []
  if (m.projectCalendarUid !== null) usedUids.push(m.projectCalendarUid)
  for (const t of m.tasks) if (t.calendarUid !== null && !usedUids.includes(t.calendarUid)) usedUids.push(t.calendarUid)

  const existingByName = new Map<string, CalendarRow>()
  for (const c of state.calendars) existingByName.set(c.name.trim().toLowerCase(), c)
  // Two file calendars with one name are BOTH suffixed by UID, so a revision that reorders tasks cannot swap them.
  const baseName = (fc: MspdiCalendar) => fc.name.trim() || `Calendar ${fc.uid}`
  const nameCount = new Map<string, number>()
  for (const fc of m.calendars) nameCount.set(baseName(fc).toLowerCase(), (nameCount.get(baseName(fc).toLowerCase()) ?? 0) + 1)
  for (const uid of usedUids) {
    const fc = fileCalendars.get(uid)
    if (!fc) continue
    const base = baseName(fc)
    const name = cap(`${CALENDAR_PREFIX}${base}${(nameCount.get(base.toLowerCase()) ?? 0) > 1 ? ` (UID ${fc.uid})` : ''}`, CALENDAR_NAME_MAX)
    calendarRefs.set(uid, planCalendar(state, fc, name, existingByName.get(name.toLowerCase()) ?? null, m, newKey, calendarOps, warnings))
  }
  for (const p of calendarRefs.values()) if (p.changed) diff.calendarChanged = true

  // ------------------------------------------------------------ programme
  const programmeFields: Record<string, unknown> = {}
  if (m.projectCalendarUid !== null) {
    const def = calendarRefs.get(m.projectCalendarUid)
    if (def && def.ref !== state.programme.default_calendar_id) {
      programmeFields.default_calendar_id = def.ref
      diff.calendarChanged = true
    }
  }
  if ((firstImport || !state.programme.project_start) && m.startDate !== state.programme.project_start) {
    programmeFields.project_start = m.startDate
  } else if (m.startDate < state.programme.project_start) {
    warnings.push(`The file starts on ${m.startDate}, before the programme start ${state.programme.project_start}. The programme start was not moved; change it in the programme settings if the work really starts earlier.`)
  }
  if (m.statusDate !== null && m.statusDate !== state.programme.data_date) {
    programmeFields.data_date = m.statusDate
    diff.dataDate = { from: state.programme.data_date, to: m.statusDate }
    if (state.programme.data_date !== null && m.statusDate < state.programme.data_date) {
      warnings.push(`The file's status date moves the data date back from ${state.programme.data_date} to ${m.statusDate}.`)
    }
  }
  ops.push(...calendarOps)
  if (Object.keys(programmeFields).length > 0) ops.push({ op: 'set_programme', fields: programmeFields })

  // ------------------------------------------------------------ restores
  // A tombstoned UID that is back must be restored before it can be updated,
  // and restore_activity refuses while its (current) parent is tombstoned. So
  // its tombstoned IMPORTED ancestors are restored first and, when they are
  // not in the file, deleted again once their children have moved. A removed
  // E-Site ancestor blocks the restore: the import never names an E-Site row.
  const fileUids = new Set(m.tasks.map((t) => t.uid))
  const byId = new Map(state.activities.map((a) => [a.id, a]))
  const restoreOrder: string[] = []
  const restoring = new Set<string>()
  const reDelete: ActivityRow[] = []
  const blocked = new Set<string>() // file UIDs left removed
  const removedEsiteAncestor = (a: ActivityRow): ActivityRow | null => {
    for (let p = a.parent_id !== null ? byId.get(a.parent_id) : undefined, hops = 0; p && p.is_tombstoned && hops < 10000;
      p = p.parent_id !== null ? byId.get(p.parent_id) : undefined, hops++) {
      if (p.external_uid === null) return p
    }
    return null
  }
  const restore = (a: ActivityRow) => {
    if (restoring.has(a.id)) return
    const parent = a.parent_id !== null ? byId.get(a.parent_id) : undefined
    if (parent && parent.is_tombstoned) restore(parent)
    restoring.add(a.id)
    restoreOrder.push(a.id)
    if (a.external_uid === null || !fileUids.has(a.external_uid)) reDelete.push(a)
  }
  for (const t of m.tasks) {
    const a = byUid.get(t.uid)
    if (!a || !a.is_tombstoned) continue
    const esite = removedEsiteAncestor(a)
    if (esite) {
      blocked.add(t.uid)
      warnings.push(`${label(t)} returned under a removed E-Site activity ("${esite.name}"), which an import cannot restore, so it was left removed. Restore "${esite.name}" in E-Site and import again.`)
      continue
    }
    restore(a)
  }
  for (const id of restoreOrder) ops.push({ op: 'restore_activity', id })

  // ------------------------------------------------------------ outline
  const tasks = blocked.size === 0 ? m.tasks : m.tasks.filter((t) => !blocked.has(t.uid))
  const linksOf = (t: MspdiTask) => (blocked.size === 0 ? t.predecessors : t.predecessors.filter((l) => !blocked.has(l.uid)))
  const hasPred = new Set<string>()
  const hasSucc = new Set<string>()
  for (const t of tasks) {
    const preds = linksOf(t)
    if (preds.length > 0) hasPred.add(t.uid)
    for (const l of preds) hasSucc.add(l.uid)
  }
  const refOfUid = new Map<string, string>() // file uid → activity id (existing) or key (new)
  const parentUid = new Map<string, string | null>()
  // A blocked UID still holds its place in the outline, so its children go under the nearest active ancestor.
  const stack: Array<{ level: number; uid: string }> = []
  for (const t of m.tasks) {
    while (stack.length > 0 && stack[stack.length - 1].level >= t.outlineLevel) stack.pop()
    let i = stack.length - 1
    while (i >= 0 && blocked.has(stack[i].uid)) i--
    parentUid.set(t.uid, i >= 0 ? stack[i].uid : null)
    stack.push({ level: t.outlineLevel, uid: t.uid })
  }

  // ------------------------------------------------------------ links (deletes first)
  const desiredLinks = new Map<string, { pred: string; succ: string; type: DependencyRow['type']; lag: number; lag_unit: DependencyRow['lag_unit'] }>()
  for (const t of tasks) {
    for (const l of linksOf(t)) {
      if (l.uid === t.uid) continue
      const k = `${l.uid}|${t.uid}|${l.type}`
      if (desiredLinks.has(k)) {
        warnings.push(`${label(t)}: the ${l.type} link from UID ${l.uid} appears twice; the first was kept.`)
        continue
      }
      desiredLinks.set(k, { pred: l.uid, succ: t.uid, type: l.type, lag: round2(l.lag), lag_unit: l.lagUnit })
    }
  }
  const uidOfId = new Map<string, string>()
  for (const a of state.activities) if (a.external_uid !== null) uidOfId.set(a.id, a.external_uid)
  const matchedLinks = new Map<string, DependencyRow>()
  const linkUpdates: ProgrammeOp[] = []
  const linkDeletes: ProgrammeOp[] = []
  const staleLinks: DependencyRow[] = [] // imported–imported links the file no longer has
  for (const d of state.dependencies) {
    const pu = uidOfId.get(d.pred_id)
    const su = uidOfId.get(d.succ_id)
    if (pu === undefined || su === undefined) continue // touches an E-Site activity
    const k = `${pu}|${su}|${d.type}`
    const want = desiredLinks.get(k)
    if (want && !matchedLinks.has(k)) {
      matchedLinks.set(k, d)
      if (round2(d.lag) !== want.lag || d.lag_unit !== want.lag_unit || d.lag_calendar !== LAG_CALENDAR) {
        linkUpdates.push({ op: 'upsert_dependency', id: d.id, lag: want.lag, lag_unit: want.lag_unit, lag_calendar: LAG_CALENDAR })
        diff.linksChanged++
      }
      continue
    }
    diff.linksRemoved++
    staleLinks.push(d)
    // A link to an activity that is deleted below goes with it; naming it again would be refused.
    if (fileUids.has(pu) && fileUids.has(su)) linkDeletes.push({ op: 'delete_dependency', id: d.id })
  }
  ops.push(...linkDeletes)

  // ------------------------------------------------------------ activities
  const esiteChildren = new Map<string, number>() // live E-Site activities per parent id
  for (const a of state.activities) {
    if (a.external_uid === null && !a.is_tombstoned && a.parent_id !== null) esiteChildren.set(a.parent_id, (esiteChildren.get(a.parent_id) ?? 0) + 1)
  }
  for (let i = 0; i < m.tasks.length; i++) {
    const t = m.tasks[i]
    if (blocked.has(t.uid)) continue
    const existing = byUid.get(t.uid)
    const pUid = parentUid.get(t.uid) ?? null
    const desired = desiredFields(t, i + 1, pUid === null ? null : (refOfUid.get(pUid) as string), hasPred, hasSucc, calendarRefs, warnings)

    if (!existing) {
      const key = newKey()
      refOfUid.set(t.uid, key)
      ops.push({ op: 'upsert_activity', key, fields: desired as ActivityFields })
      diff.added.push({ uid: t.uid, name: desired.name as string })
      continue
    }
    refOfUid.set(t.uid, existing.id)
    mergeProgress(t, existing, desired, warnings)
    if (existing.is_tombstoned) {
      warnings.push(`${label(t)} was removed before and is back in the file; it was restored with its E-Site data.`)
    }
    if (existing.type === 'summary' && desired.type !== 'summary' && (esiteChildren.get(existing.id) ?? 0) > 0) {
      warnings.push(`${label(t)} is no longer a summary in the file, but it holds activities added in E-Site. Move them to a summary.`)
    }
    const fields: Record<string, unknown> = {}
    for (const f of IMPORT_FIELDS) {
      if (norm(existing[f]) !== norm(desired[f])) fields[f] = desired[f]
    }
    if (Object.keys(fields).length > 0) ops.push({ op: 'upsert_activity', id: existing.id, fields: fields as ActivityFields })
    const changedNames = Object.keys(fields).filter((f) => f !== 'sort_order')
    if (existing.is_tombstoned) diff.added.push({ uid: t.uid, name: desired.name as string })
    else if (changedNames.length > 0) diff.changed.push({ uid: t.uid, name: desired.name as string, fields: changedNames })
    else diff.unchanged++
  }

  // ------------------------------------------------------------ links (updates and new)
  ops.push(...linkUpdates)
  for (const [k, l] of desiredLinks) {
    if (matchedLinks.has(k)) continue
    ops.push({
      op: 'upsert_dependency', pred: refOfUid.get(l.pred) as string, succ: refOfUid.get(l.succ) as string,
      type: l.type, lag: l.lag, lag_unit: l.lag_unit, lag_calendar: LAG_CALENDAR,
    })
    diff.linksAdded++
  }

  // ------------------------------------------------------------ removals
  // After the upserts, every imported activity still in the file sits under
  // its new parent, so a removed activity's live children are either removed
  // too or made in E-Site.
  const parentAfter = new Map<string, string | null>()
  for (const a of state.activities) parentAfter.set(a.id, a.parent_id)
  for (const t of tasks) {
    const a = byUid.get(t.uid)
    if (a) {
      const p = parentUid.get(t.uid) ?? null
      parentAfter.set(a.id, p === null ? null : (refOfUid.get(p) as string))
    }
  }
  const removed = state.activities.filter((a) => a.external_uid !== null && !a.is_tombstoned && !fileUids.has(a.external_uid))
  const toDelete = new Set<string>([...removed.map((a) => a.id), ...reDelete.map((a) => a.id)])
  const liveAfter = (a: ActivityRow) => (!a.is_tombstoned || restoring.has(a.id))
  // An activity that holds a live activity that is not being deleted must stay; repeat up the tree.
  const kept = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const a of state.activities) {
      if (!liveAfter(a) || (toDelete.has(a.id) && !kept.has(a.id))) continue
      let p = parentAfter.get(a.id) ?? null
      while (p !== null && toDelete.has(p) && !kept.has(p)) {
        kept.add(p)
        grew = true
        p = parentAfter.get(p) ?? null
      }
    }
  }
  const depth = (id: string) => {
    let d = 0
    for (let p = parentAfter.get(id) ?? null; p !== null && d < 10000; p = parentAfter.get(p) ?? null) d++
    return d
  }
  const deletions = [...toDelete].filter((id) => !kept.has(id)).sort((x, y) => depth(y) - depth(x))
  for (const a of removed) {
    if (kept.has(a.id)) {
      warnings.push(`Task "${a.name}" (UID ${a.external_uid}) is no longer in the file, but it holds activities added in E-Site, so it was kept. Move them and delete it.`)
    } else {
      diff.removed.push({ uid: a.external_uid as string, name: a.name })
    }
  }
  for (const a of reDelete) {
    if (kept.has(a.id)) warnings.push(`"${a.name}" was restored so the activities under it could come back; it was kept because it still holds activities.`)
  }
  // delete_activity takes every link of the activity with it; say so for links to E-Site's own activities.
  const deleting = new Set(deletions)
  for (const d of state.dependencies) {
    const pd = deleting.has(d.pred_id)
    const sd = deleting.has(d.succ_id)
    if (pd === sd) continue
    const gone = byId.get(pd ? d.pred_id : d.succ_id) as ActivityRow
    const other = byId.get(pd ? d.succ_id : d.pred_id)
    if (!gone || !other || other.external_uid !== null || gone.external_uid === null) continue
    warnings.push(`"${gone.name}" (UID ${gone.external_uid}) was removed by the contractor; its link to "${other.name}" was dropped.`)
  }
  // A KEPT removed activity is not deleted, so its links to other imported
  // activities (already counted as removed) must be deleted by name.
  for (const d of staleLinks) {
    if (deleting.has(d.pred_id) || deleting.has(d.succ_id)) continue
    const pu = uidOfId.get(d.pred_id) as string
    const su = uidOfId.get(d.succ_id) as string
    if (fileUids.has(pu) && fileUids.has(su)) continue // already deleted above
    ops.push({ op: 'delete_dependency', id: d.id })
  }
  for (const id of deletions) ops.push({ op: 'delete_activity', id })

  return { ops, diff, warnings }
}

function desiredFields(
  t: MspdiTask,
  sortOrder: number,
  parentRef: string | null,
  hasPred: Set<string>,
  hasSucc: Set<string>,
  calendarRefs: Map<string, CalendarPlan>,
  warnings: string[],
): Desired {
  let name = t.name.trim()
  if (name === '') {
    name = `Task ${t.uid}`
    warnings.push(`Task UID ${t.uid} has no name; it was imported as "${name}".`)
  }
  name = cap(name, NAME_MAX)

  let type: ActivityType = 'task'
  if (t.summary) type = 'summary'
  else if (t.milestone) type = !hasPred.has(t.uid) && hasSucc.has(t.uid) ? 'start_milestone' : 'finish_milestone'
  const duration = type === 'task' ? round2(Math.max(0, t.durationDays)) : 0

  let actualFinish = t.actualFinish
  if (actualFinish !== null && t.actualStart !== null && actualFinish < t.actualStart) {
    warnings.push(`${label(t)} finished (${actualFinish}) before it started (${t.actualStart}); the actual finish was dropped.`)
    actualFinish = null
  }
  const wbs = (t.wbs ?? t.outlineNumber)?.trim() || null

  return {
    parent_id: parentRef,
    wbs_code: wbs,
    name,
    type,
    original_duration: duration,
    calendar_id: t.calendarUid !== null ? (calendarRefs.get(t.calendarUid)?.ref ?? null) : null,
    constraint_type: t.constraint?.type ?? null,
    constraint_date: t.constraint?.date ?? null,
    deadline: t.deadline,
    actual_start: t.actualStart,
    actual_finish: actualFinish,
    percent_complete: round2(Math.min(100, Math.max(0, t.percentComplete))),
    remaining_duration: null,
    sort_order: sortOrder,
    external_uid: t.uid,
  }
}

/**
 * Ruling C1: progress recorded in E-Site is never wiped by a silent file.
 * Rewrites `desired`'s progress fields in place for an EXISTING activity.
 */
function mergeProgress(t: MspdiTask, existing: ActivityRow, desired: Desired, warnings: string[]): void {
  const fileStarted = desired.actual_start !== null || desired.actual_finish !== null
  const fileHas = {
    actual_start: desired.actual_start !== null,
    actual_finish: desired.actual_finish !== null,
    percent_complete: fileStarted || (desired.percent_complete as number) > 0,
  }
  let progressChanged = false
  for (const f of ['actual_start', 'actual_finish', 'percent_complete'] as const) {
    const mine = existing[f]
    if (!fileHas[f]) {
      desired[f] = mine
      continue
    }
    if (norm(mine) === norm(desired[f])) continue
    progressChanged = true
    const esiteHad = f === 'percent_complete' ? (mine as number) !== 0 : mine !== null
    if (esiteHad) {
      warnings.push(`${label(t)}: the contractor's file reports ${PROGRESS_LABEL[f]} ${desired[f]}; E-Site had ${mine}. The file's value was used.`)
    }
  }
  // A kept E-Site actual that now contradicts the file's actual is cleared.
  const as = desired.actual_start as string | null
  const af = desired.actual_finish as string | null
  if (as !== null && af !== null && af < as) {
    if (!fileHas.actual_finish) {
      warnings.push(`${label(t)}: E-Site's actual finish ${af} is before the file's actual start ${as}, so it was cleared.`)
      desired.actual_finish = null
    } else {
      warnings.push(`${label(t)}: E-Site's actual start ${as} is after the file's actual finish ${af}, so it was cleared.`)
      desired.actual_start = null
    }
    progressChanged = true
  }
  // remaining_duration is E-Site's; it is cleared only when it can no longer be right.
  const remaining = existing.remaining_duration
  desired.remaining_duration = remaining
  if (remaining !== null) {
    const durationChanged = norm(existing.original_duration) !== norm(desired.original_duration)
    if (progressChanged || durationChanged) {
      desired.remaining_duration = null
      const why = progressChanged ? 'the file reports progress' : 'the file changed the duration'
      warnings.push(`${label(t)}: E-Site's remaining duration of ${dayCount(remaining)} was cleared because ${why}; it is now worked out from the actual dates.`)
    }
  }
}

/** One file calendar → ops that make an E-Site calendar of the same name match it. */
function planCalendar(
  state: ProgrammeState,
  fc: MspdiCalendar,
  name: string,
  existing: CalendarRow | null,
  m: MspdiProgramme,
  newKey: () => string,
  out: ProgrammeOp[],
  warnings: string[],
): CalendarPlan {
  let weekdays = fc.workWeekdays
  if (weekdays.length === 0) {
    warnings.push(`Calendar "${name}" has no working weekdays; Monday to Friday was used.`)
    weekdays = MON_TO_FRI
  }
  const hours = round2(Math.min(24, Math.max(0.25, m.minutesPerDay / 60)))

  // Later exceptions win over earlier ones on the same day, as in MS Project's list order.
  const days = new Map<CalendarDate, { kind: 'non_work' | 'work'; label: string | null }>()
  for (const e of fc.exceptions) {
    const kind = e.working ? 'work' : 'non_work'
    const lab = e.name.trim() || null
    for (let n = dayNumber(e.from); n <= dayNumber(e.to); n++) days.set(fromDayNumber(n), { kind, label: lab })
  }
  const exceptions = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, v]) => ({ day, kind: v.kind, label: v.label }))

  if (existing) {
    const sameWeek = existing.work_weekdays.length === weekdays.length && existing.work_weekdays.every((d, i) => d === weekdays[i])
    const calFields: Record<string, unknown> = {}
    if (!sameWeek) calFields.work_weekdays = weekdays
    if (round2(existing.hours_per_day) !== hours) calFields.hours_per_day = hours
    if (existing.name !== name) calFields.name = name
    if (Object.keys(calFields).length > 0) out.push({ op: 'upsert_calendar', id: existing.id, fields: calFields })
    const current = state.exceptions
      .filter((e) => e.calendar_id === existing.id)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      .map((e) => `${e.day}|${e.kind}|${e.label ?? ''}`)
    const next = exceptions.map((e) => `${e.day}|${e.kind}|${e.label ?? ''}`)
    const sameEx = current.length === next.length && current.every((x, i) => x === next[i])
    if (!sameEx) {
      const dropped = state.exceptions
        .filter((e) => e.calendar_id === existing.id && !days.has(e.day))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
        .map((e) => (e.label ? `${e.day} (${e.label})` : e.day))
      if (dropped.length > 0) {
        warnings.push(`Calendar "${name}": the file does not have ${dropped.join(', ')}, which ${dropped.length === 1 ? 'was' : 'were'} added in E-Site; ${dropped.length === 1 ? 'it was' : 'they were'} removed.`)
      }
    }
    if (!sameEx) out.push({ op: 'set_calendar_exceptions', calendar: existing.id, exceptions })
    const changed = Object.keys(calFields).length > 0 || !sameEx
    return { ref: existing.id, changed }
  }

  const key = newKey()
  out.push({ op: 'upsert_calendar', key, fields: { name, variant: 'custom', work_weekdays: weekdays, hours_per_day: hours } })
  if (exceptions.length > 0) out.push({ op: 'set_calendar_exceptions', calendar: key, exceptions })
  return { ref: key, changed: true }
}
