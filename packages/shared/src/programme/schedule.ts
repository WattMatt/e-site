import { applyAlap, backwardPass, type LateTimes } from './backward'
import { buildEngineCalendar, displayFinish, displayStart, type EngineCalendar } from './calendar'
import { criticalIds, drivingLinks, drivingPredsOf, traceDrivingPath } from './critical'
import { freeFloats, scheduleWarnings, totalFloats } from './float'
import { detectOutOfSequence, displayMilestone, forwardPass, type MomentKind, type Times } from './forward'
import { normaliseProgramme } from './normalise'
import { levelOfEffortTimes, rollUpSummaries } from './rollup'
import { ISSUE_SEVERITY } from './types'
import type { ActivityInput, CalendarDate, DependencyInput, Instant, ProgrammeInput, ScheduledActivity, ScheduleIssue, ScheduleResult } from './types'

const EPS = 1e-9

/** Driving links by successor for each result `scheduleProgramme` returned, so `drivingPath` is exact
 *  (a summary link expands to several leaf pairs under one id, and only some of them may drive). */
const drivingCache = new WeakMap<ScheduleResult, Map<string, DependencyInput[]>>()

const round3 = (x: number) => {
  const r = Math.round(x * 1000) / 1000
  return r === 0 ? 0 : r // no -0
}

/**
 * Schedules a programme. Order of work: validate → normalise (any error stops here: `ok:false`, nothing
 * scheduled) → calendars → forward → backward → floats (from the pre-ALAP early dates, ruling 5b) → ALAP →
 * warnings → level-of-effort spans → summary roll-up → driving links and critical → coverage warning → display.
 * Issues: every validation/normalise issue, `out_of_sequence`, `negative_float`, `deadline_missed`, and one
 * `calendar_out_of_range` per calendar. `ok` is false iff an issue is an error.
 */
export function scheduleProgramme(input: ProgrammeInput): ScheduleResult {
  return compute(input).result
}

function failed(issues: ScheduleIssue[]): ScheduleResult {
  return { ok: false, activities: new Map(), drivingLinkIds: new Set(), projectFinish: null, issues }
}

function compute(input: ProgrammeInput): { result: ScheduleResult; predsOf: Map<string, DependencyInput[]> } {
  const norm = normaliseProgramme(input)
  const n = norm.value
  if (n === null || norm.issues.some(i => i.severity === 'error')) return { result: failed(norm.issues), predsOf: new Map() }

  const cals = new Map<string, EngineCalendar>(input.calendars.map(c => [c.id, buildEngineCalendar(c)]))
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  const defaultCal = cals.get(input.defaultCalendarId)!

  const early = forwardPass(n, input, cals)
  const { late, projectFinish } = backwardPass(n, input, cals, early)
  const tf = totalFloats(n, input, cals, early, late)
  const ff = freeFloats(n, input, cals, early, late, projectFinish)
  applyAlap(n, input, cals, early, late)

  const issues: ScheduleIssue[] = [...norm.issues, ...detectOutOfSequence(n, input), ...scheduleWarnings(n, input, cals, early, tf)]

  // Level of effort: span from the neighbours' final early times; late = early; TF = FF = 0.
  for (const [id, t] of levelOfEffortTimes(n, input, cals, early)) {
    early.set(id, t)
    late.set(id, { ls: t.es, lf: t.ef })
    tf.set(id, 0)
    ff.set(id, 0)
  }
  const summaries = rollUpSummaries(n, input, defaultCal, early, late, tf)

  const driving = drivingLinks(n, input, cals, early)
  const critical = criticalIds(n, input, cals, early, tf, driving, projectFinish)

  issues.push(...coverageWarnings(n.leaves, calOf, early, late))

  const display = (cal: EngineCalendar, s: Instant, f: Instant, kind: MomentKind | undefined): [CalendarDate, CalendarDate] => {
    if (kind) return [displayMilestone(cal, s, kind), displayMilestone(cal, f, kind)]
    // A zero-length task (f = s) shows its start day twice rather than a finish before its start.
    return [displayStart(s), f > s + EPS ? displayFinish(cal, f) : displayStart(s)]
  }
  const activities = new Map<string, ScheduledActivity>()
  for (const a of input.activities) {
    if (a.type === 'summary') {
      const r = summaries.get(a.id)!
      const [es, ef] = display(defaultCal, r.es, r.ef, undefined)
      const [ls, lf] = display(defaultCal, r.ls, r.lf, undefined)
      activities.set(a.id, {
        id: a.id, earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf,
        totalFloat: round3(r.tf), freeFloat: 0, isCritical: false,
      })
      continue
    }
    const cal = calOf(a)
    const e = early.get(a.id)!
    const l = late.get(a.id)!
    const milestone = a.type === 'start_milestone' || a.type === 'finish_milestone'
    const defaultKind: MomentKind = a.type === 'start_milestone' ? 'start' : 'finish'
    const [es, ef] = display(cal, e.es, e.ef, milestone ? (e.kind ?? defaultKind) : undefined)
    const [ls, lf] = display(cal, l.ls, l.lf, milestone ? (l.kind ?? defaultKind) : undefined)
    activities.set(a.id, {
      id: a.id, earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf,
      totalFloat: round3(tf.get(a.id)!), freeFloat: round3(ff.get(a.id)!), isCritical: critical.has(a.id),
    })
  }

  const result: ScheduleResult = {
    ok: !issues.some(i => i.severity === 'error'),
    activities,
    drivingLinkIds: new Set(driving.map(l => l.id)),
    projectFinish: Number.isFinite(projectFinish) ? displayFinish(defaultCal, projectFinish) : null,
    issues,
  }
  const predsOf = drivingPredsOf(driving)
  drivingCache.set(result, predsOf)
  return { result, predsOf }
}

/** One `calendar_out_of_range` warning per calendar with any early or late date outside its coverage,
 *  naming the activities. A finish on a day boundary is checked on the day it ends (the one before). */
function coverageWarnings(leaves: ActivityInput[], calOf: (a: ActivityInput) => EngineCalendar,
  early: Map<string, Times>, late: Map<string, LateTimes>): ScheduleIssue[] {
  const byCal = new Map<string, string[]>()
  // A finish instant, and a finish-kind milestone moment, are checked at t − ε (the day they end on).
  // A zero-length task (f = s) shows its start day twice (ruling 7(2)), so its finish is checked at t.
  const checks = (s: Instant, f: Instant, kind: MomentKind | undefined): Instant[] =>
    kind === 'finish' ? [s - EPS, f - EPS] : kind === 'start' ? [s, f] : [s, f > s + EPS ? f - EPS : f]
  for (const a of leaves) {
    const cal = calOf(a)
    const e = early.get(a.id)!
    const l = late.get(a.id)!
    const instants = [...checks(e.es, e.ef, e.kind), ...checks(l.ls, l.lf, l.kind)]
    if (instants.every(t => cal.inCoverage(t))) continue
    const list = byCal.get(cal.id)
    if (list) list.push(a.id)
    else byCal.set(cal.id, [a.id])
  }
  return [...byCal].map(([calId, ids]) => ({
    code: 'calendar_out_of_range' as const, severity: ISSUE_SEVERITY.calendar_out_of_range,
    activityIds: ids, dependencyIds: [],
    message: `Calendar ${calId} has no holiday or exception data for some dates of ${ids.join(', ')}; weekdays alone were used there.`,
  }))
}

/** The driving chain into `targetId`, from the activity that starts it to the target, in order (see
 *  `traceDrivingPath`). Empty when the schedule failed or the target is not a scheduled leaf. */
export function drivingPath(result: ScheduleResult, input: ProgrammeInput, targetId: string):
  { activityIds: string[]; dependencyIds: string[] } {
  const target = input.activities.find(a => a.id === targetId)
  if (!result.ok || !result.activities.has(targetId) || !target || target.type === 'summary') {
    return { activityIds: [], dependencyIds: [] }
  }
  const predsOf = drivingCache.get(result) ?? compute(input).predsOf
  return traceDrivingPath(predsOf, targetId)
}
