import { liveLinks, linkLimit, durationOf, type LateTimes } from './backward'
import { startOf, type EngineCalendar } from './calendar'
import type { Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import { ISSUE_SEVERITY } from './types'
import type { ActivityInput, Instant, ProgrammeInput, ScheduleIssue, ScheduleOptions } from './types'

const EPS = 1e-9

/** Total float in working days on the activity's own calendar. Not rounded (Task 7 rounds at output). */
export function totalFloat(cal: EngineCalendar, e: Times, l: LateTimes, on: ScheduleOptions['floatOn']): number {
  const start = cal.workBetween(e.es, l.ls)
  const finish = cal.workBetween(e.ef, l.lf)
  if (on === 'start') return start
  if (on === 'finish') return finish
  return Math.min(start, finish)
}

/** Total float of every leaf with `options.floatOn`. Compute it from the PRE-ALAP early dates (ruling 5b). */
export function totalFloats(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, late: Map<string, LateTimes>): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of n.leaves) {
    const cal = cals.get(a.calendarId ?? input.defaultCalendarId)!
    out.set(a.id, totalFloat(cal, early.get(a.id)!, late.get(a.id)!, input.options.floatOn))
  }
  return out
}

/** Free float of every leaf: the smallest slack before any successor's early date moves (or before
 *  projectFinish, with none), capped at total float (ruling 4c): min(FF, max(TF, 0)), never below 0.
 *  LOE and ALAP activities get 0. Compute it from the PRE-ALAP early dates (ruling 5b). One pass, O(links). */
export function freeFloats(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, late: Map<string, LateTimes>, projectFinish: Instant): Map<string, number> {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const calOf = (x: ActivityInput) => cals.get(x.calendarId ?? input.defaultCalendarId)!
  const projectCal = cals.get(input.defaultCalendarId)!
  const out = new Map<string, number>()
  for (const a of n.leaves) {
    if (a.type === 'level_of_effort' || a.constraint?.type === 'alap') {
      out.set(a.id, 0)
      continue
    }
    const cal = calOf(a)
    const e = early.get(a.id)!
    const succs = liveLinks(n.succsOf.get(a.id), byId)
    let ff = Infinity
    for (const link of succs) {
      const succ = byId.get(link.succId)!
      const se = early.get(succ.id)!
      const { on, at } = linkLimit(link, { s: se.es, f: se.ef }, cal, calOf(succ), projectCal, durationOf(a))
      ff = Math.min(ff, cal.workBetween(on === 'start' ? e.es : e.ef, at))
    }
    if (succs.length === 0) ff = cal.workBetween(e.ef, projectFinish)
    const tf = totalFloat(cal, e, late.get(a.id)!, input.options.floatOn)
    out.set(a.id, Math.max(0, Math.min(ff, tf)))
  }
  return out
}

/** `negative_float` (one issue naming every activity whose total float in `tf` is < 0; pass the pre-ALAP
 *  `totalFloats`) and `deadline_missed` (`early` finish after the deadline; pass the post-ALAP early dates). */
export function scheduleWarnings(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, tf: Map<string, number>): ScheduleIssue[] {
  const negative: string[] = []
  const missed: string[] = []
  for (const a of n.leaves) {
    if (a.type === 'level_of_effort') continue
    const cal = cals.get(a.calendarId ?? input.defaultCalendarId)!
    const e = early.get(a.id)!
    if (tf.get(a.id)! < -EPS) negative.push(a.id)
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
