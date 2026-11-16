import { liveLinks, linkLimit, durationOf, type LateTimes } from './backward'
import { startOf, type EngineCalendar } from './calendar'
import type { Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import { ISSUE_SEVERITY } from './types'
import type { Instant, ProgrammeInput, ScheduleIssue, ScheduleOptions } from './types'

const EPS = 1e-9

/** Total float in working days on the activity's own calendar. Not rounded (Task 7 rounds at output). */
export function totalFloat(cal: EngineCalendar, e: Times, l: LateTimes, on: ScheduleOptions['floatOn']): number {
  const start = cal.workBetween(e.es, l.ls)
  const finish = cal.workBetween(e.ef, l.lf)
  if (on === 'start') return start
  if (on === 'finish') return finish
  return Math.min(start, finish)
}

/** The smallest slack before any successor's early date moves (or before projectFinish, with none). Never below 0. */
export function freeFloat(id: string, n: NormalisedProgramme, early: Map<string, Times>,
  cals: Map<string, EngineCalendar>, projectFinish: Instant, input: ProgrammeInput): number {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const a = byId.get(id)!
  if (a.type === 'level_of_effort' || a.constraint?.type === 'alap') return 0
  const calOf = (x: typeof a) => cals.get(x.calendarId ?? input.defaultCalendarId)!
  const cal = calOf(a)
  const projectCal = cals.get(input.defaultCalendarId)!
  const e = early.get(id)!

  const succs = liveLinks(n.succsOf.get(id), byId)
  let ff = Infinity
  for (const link of succs) {
    const succ = byId.get(link.succId)!
    const se = early.get(succ.id)!
    const { on, at } = linkLimit(link, { s: se.es, f: se.ef }, cal, calOf(succ), projectCal, durationOf(a))
    ff = Math.min(ff, cal.workBetween(on === 'start' ? e.es : e.ef, at))
  }
  if (succs.length === 0) ff = cal.workBetween(e.ef, projectFinish)
  return Math.max(0, ff)
}

/** `negative_float` (one issue naming every activity with TF < 0) and `deadline_missed` (early finish after the deadline). */
export function scheduleWarnings(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, late: Map<string, LateTimes>): ScheduleIssue[] {
  const negative: string[] = []
  const missed: string[] = []
  for (const a of n.leaves) {
    if (a.type === 'level_of_effort') continue
    const cal = cals.get(a.calendarId ?? input.defaultCalendarId)!
    const e = early.get(a.id)!
    if (totalFloat(cal, e, late.get(a.id)!, input.options.floatOn) < -EPS) negative.push(a.id)
    if (a.deadline && cal.workPos(e.ef) > cal.workPos(startOf(a.deadline) + 1) + EPS) missed.push(a.id)
  }
  const issues: ScheduleIssue[] = []
  if (negative.length > 0) {
    issues.push({
      code: 'negative_float', severity: ISSUE_SEVERITY.negative_float, activityIds: negative, dependencyIds: [],
      message: `Negative float: ${negative.join(', ')} cannot meet ${negative.length === 1 ? 'its' : 'their'} constraints or deadlines.`,
    })
  }
  if (missed.length > 0) {
    issues.push({
      code: 'deadline_missed', severity: ISSUE_SEVERITY.deadline_missed, activityIds: missed, dependencyIds: [],
      message: `Deadline missed: ${missed.join(', ')} finish${missed.length === 1 ? 'es' : ''} after the deadline.`,
    })
  }
  return issues
}
