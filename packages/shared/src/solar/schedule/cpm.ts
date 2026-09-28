/**
 * Critical path for the Solar schedule (spec §14.2): all four link types and
 * lag, on the tasks' PLANNED dates, on ALL tasks regardless of filters.
 *
 * Units: calendar mode = days since the earliest start; working mode = working
 * days before the date since the earliest start (a non-working date shares the
 * unit of the next working day). S = unit(start); d = spanDays (0 for a
 * milestone); F = S + d (exclusive). Backward pass in reverse topological order:
 *   LF(p) = min(projectFinish, bound per outgoing link p→s, lag L)
 *     FS: LS_s − L        SS: LS_s − L + d_p
 *     FF: LF_s − L        SF: LF_s − L + d_p
 * LS = LF − d; total float = LS − S; critical ⇔ float ≤ 0. Negative float means
 * the plan breaks a link; each such link is listed in `violations`.
 */
import { addCalendarDays, daysBetween, type CalendarDate } from './dates'
import { isWorkingDate, spanDays, type WorkCalendar } from './calendar'
import { linkKey, topoOrder, type ScheduleLink } from './graph'

export interface CpmTask {
  readonly id: string
  readonly start: CalendarDate
  readonly end: CalendarDate
  readonly isMilestone: boolean
}

export interface LinkViolation {
  readonly link: ScheduleLink
  readonly shortByDays: number
}

export type CpmResult =
  | {
      ok: true
      critical: ReadonlySet<string>
      criticalLinks: ReadonlySet<string>
      totalFloat: ReadonlyMap<string, number>
      /** Programme length on the critical path, in the calendar's units. */
      lengthDays: number
      violations: LinkViolation[]
    }
  | { ok: false; cycle: string[] }

function unitScale(cal: WorkCalendar, anchor: CalendarDate): (d: CalendarDate) => number {
  if (cal.mode === 'calendar') return (d) => daysBetween(anchor, d)
  const cum: number[] = [0] // cum[i] = working days in [anchor, anchor + i)
  return (d) => {
    const i = daysBetween(anchor, d)
    while (cum.length <= i) {
      const k = cum.length - 1
      cum.push(cum[k] + (isWorkingDate(cal, addCalendarDays(anchor, k)) ? 1 : 0))
    }
    return cum[i]
  }
}

export function criticalPath(tasks: readonly CpmTask[], links: readonly ScheduleLink[], cal: WorkCalendar): CpmResult {
  if (tasks.length === 0) {
    return { ok: true, critical: new Set(), criticalLinks: new Set(), totalFloat: new Map(), lengthDays: 0, violations: [] }
  }
  const ids = tasks.map((t) => t.id)
  const topo = topoOrder(ids, links)
  if (!topo.ok) return { ok: false, cycle: topo.cycle }

  const byId = new Map(tasks.map((t) => [t.id, t]))
  const anchor = tasks.reduce((m, t) => (t.start < m ? t.start : m), tasks[0].start)
  const unit = unitScale(cal, anchor)
  const dur = new Map<string, number>()
  const S = new Map<string, number>()
  const F = new Map<string, number>()
  for (const t of tasks) {
    const d = t.isMilestone ? 0 : spanDays(cal, t.start, t.end)
    dur.set(t.id, d)
    S.set(t.id, unit(t.start))
    F.set(t.id, unit(t.start) + d)
  }
  const projectFinish = Math.max(...F.values())
  const projectStart = Math.min(...S.values())

  const live = links.filter((l) => byId.has(l.predecessorId) && byId.has(l.successorId))
  const outgoing = new Map<string, ScheduleLink[]>(ids.map((id) => [id, []]))
  for (const l of live) outgoing.get(l.predecessorId)!.push(l)

  const LF = new Map<string, number>()
  const LS = new Map<string, number>()
  for (const id of [...topo.order].reverse()) {
    const d = dur.get(id)!
    let lf = projectFinish
    for (const l of outgoing.get(id)!) {
      const s = l.successorId
      const bound =
        l.type === 'FS' ? LS.get(s)! - l.lagDays
          : l.type === 'SS' ? LS.get(s)! - l.lagDays + d
            : l.type === 'FF' ? LF.get(s)! - l.lagDays
              : LF.get(s)! - l.lagDays + d
      if (bound < lf) lf = bound
    }
    LF.set(id, lf)
    LS.set(id, lf - d)
  }

  const totalFloat = new Map(ids.map((id) => [id, LS.get(id)! - S.get(id)!]))
  const critical = new Set(ids.filter((id) => totalFloat.get(id)! <= 0))
  const violations: LinkViolation[] = []
  const criticalLinks = new Set<string>()
  for (const l of live) {
    const p = l.predecessorId
    const s = l.successorId
    const slack =
      l.type === 'FS' ? S.get(s)! - (F.get(p)! + l.lagDays)
        : l.type === 'SS' ? S.get(s)! - (S.get(p)! + l.lagDays)
          : l.type === 'FF' ? F.get(s)! - (F.get(p)! + l.lagDays)
            : F.get(s)! - (S.get(p)! + l.lagDays)
    if (slack < 0) violations.push({ link: l, shortByDays: -slack })
    if (slack <= 0 && critical.has(p) && critical.has(s)) criticalLinks.add(linkKey(l))
  }
  return { ok: true, critical, criticalLinks, totalFloat, lengthDays: projectFinish - projectStart, violations }
}
