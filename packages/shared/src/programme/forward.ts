import { displayFinish, displayStart, startOf, type EngineCalendar } from './calendar'
import type { NormalisedProgramme } from './normalise'
import { ISSUE_SEVERITY } from './types'
import type { ActivityInput, CalendarDate, DependencyInput, Instant, ProgrammeInput, ScheduleIssue } from './types'

export type MomentKind = 'start' | 'finish'
/** `kind` is set for milestones only: how their single moment (es = ef) is displayed (ruling 3). */
export interface Times { es: Instant; ef: Instant; kind?: MomentKind }

export function displayMilestone(cal: EngineCalendar, t: Instant, kind: MomentKind): CalendarDate {
  return kind === 'start' ? displayStart(t) : displayFinish(cal, t)
}

const isMilestone = (a: ActivityInput) => a.type === 'start_milestone' || a.type === 'finish_milestone'

/** Progress state of an activity (Task 6). A milestone with any actual date is complete. */
export type ProgressState = 'complete' | 'in_progress' | 'not_started'
export function progressState(a: ActivityInput): ProgressState {
  if (a.actualFinish !== null) return 'complete'
  if (a.actualStart !== null) return isMilestone(a) ? 'complete' : 'in_progress'
  return 'not_started'
}

/** Whether progress is in play, and the raw data-date instant (not yet snapped to a calendar).
 *  Progress fields are ignored only when there is no data date AND no actual date. With actuals but
 *  no data date, the data date is taken as the project start. */
export function progressContext(input: ProgrammeInput): { active: boolean; dataDate: Instant } {
  const hasActuals = input.activities.some(a => a.actualStart !== null || a.actualFinish !== null)
  if (input.dataDate !== null) return { active: true, dataDate: startOf(input.dataDate) }
  return { active: hasActuals, dataDate: startOf(input.projectStart) }
}

/** The duration the schedule places for a not-started task: `remainingDuration ?? originalDuration`
 *  when progress is in play, otherwise `originalDuration`. Milestones are 0. (Percent lags keep using
 *  the original duration.) In-progress tasks use `remainingFrom` instead. */
export function plannedDuration(a: ActivityInput, progressActive: boolean): number {
  if (isMilestone(a)) return 0
  return progressActive ? (a.remainingDuration ?? a.originalDuration) : a.originalDuration
}

/** Remaining duration of an in-progress task: `remainingDuration ?? max(0, original − work done to dd)`. */
export function remainingFrom(a: ActivityInput, cal: EngineCalendar, es: Instant, dd: Instant): number {
  return a.remainingDuration ?? Math.max(0, a.originalDuration - Math.max(0, cal.workBetween(es, dd)))
}

/** The moment of a completed milestone: a start_milestone at the start of its actual day (kind 'start'),
 *  a finish_milestone at the end of its actual (finish) day (kind 'finish'). */
export function completedMilestone(a: ActivityInput): Times {
  if (a.type === 'start_milestone') {
    const m = startOf((a.actualStart ?? a.actualFinish)!)
    return { es: m, ef: m, kind: 'start' }
  }
  const m = startOf((a.actualFinish ?? a.actualStart)!) + 1
  return { es: m, ef: m, kind: 'finish' }
}

/** Where an MSO/MFO puts an activity of duration `dur`, ignoring logic and the data date. The backward
 *  pass uses this as the late side of a not-started MSO/MFO (ruling 6(2)). A start_milestone treats MFO as
 *  MSO on the same date; a finish_milestone's MSO is a start moment, its MFO a finish moment (ruling 3). */
export function mandatoryTimes(a: ActivityInput, cal: EngineCalendar, dur: number): Times {
  const c = a.constraint!
  const day = startOf(c.date!)
  if (isMilestone(a)) {
    if (c.type === 'mso' || a.type === 'start_milestone') {
      const m = cal.snapStart(day)
      return { es: m, ef: m, kind: 'start' }
    }
    return { es: day + 1, ef: day + 1, kind: 'finish' }
  }
  const es = c.type === 'mso' ? cal.snapStart(day) : cal.snapStart(cal.addWork(day + 1, -dur, 'start'))
  return dur === 0 ? { es, ef: es } : { es, ef: cal.addWork(es, dur, 'finish') }
}

/** `out_of_sequence`: an activity with an actual start whose FS predecessor is not complete, or whose
 *  SS predecessor has not started (by `progressState`, so a milestone with only an actual start counts
 *  as complete). One warning per such activity, naming the offending links.
 *  Links touching a level_of_effort are skipped (ruling 1). Actual dates are read from the leaves, so `_input` is unused. */
export function detectOutOfSequence(n: NormalisedProgramme, _input: ProgrammeInput): ScheduleIssue[] {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const issues: ScheduleIssue[] = []
  for (const a of n.leaves) {
    if (a.actualStart === null || a.type === 'level_of_effort') continue
    const bad = (n.predsOf.get(a.id) ?? []).filter(l => {
      const pred = byId.get(l.predId)!
      if (pred.type === 'level_of_effort') return false
      if (l.type === 'FS') return progressState(pred) !== 'complete'
      if (l.type === 'SS') return progressState(pred) === 'not_started'
      return false
    })
    if (bad.length === 0) continue
    issues.push({
      code: 'out_of_sequence', severity: ISSUE_SEVERITY.out_of_sequence, activityIds: [a.id],
      dependencyIds: bad.map(l => l.id),
      message: `Out of sequence: ${a.id} started before ${bad.map(l => `${l.predId} (${l.type})`).join(', ')} allowed it.`,
    })
  }
  return issues
}

/** `x` moved by the link's lag, on the lag calendar (or elapsed, or % of the pred's duration). */
function applyLag(link: DependencyInput, x: Instant, mode: 'start' | 'finish', predCal: EngineCalendar,
  succCal: EngineCalendar, projectCal: EngineCalendar, predDuration: number): Instant {
  if (link.lagUnit === 'elapsed_days') return x + link.lag
  if (link.lagUnit === 'percent') return predCal.addWork(x, (link.lag / 100) * predDuration, mode)
  const lagCal = link.lagCalendar === 'pred' ? predCal : link.lagCalendar === 'succ' ? succCal : projectCal
  return lagCal.addWork(x, link.lag, mode)
}

/** What a link asks of its successor: a start no earlier than `at`, or a finish no earlier than `at`. */
export function linkDemand(link: DependencyInput, pred: Times, predCal: EngineCalendar, succCal: EngineCalendar,
  projectCal: EngineCalendar, predDuration: number): { on: 'start' | 'finish'; at: Instant } {
  const on: 'start' | 'finish' = link.type === 'FS' || link.type === 'SS' ? 'start' : 'finish'
  const x = link.type === 'FS' || link.type === 'FF' ? pred.ef : pred.es
  return { on, at: applyLag(link, x, on, predCal, succCal, projectCal, predDuration) }
}

/** Early dates for every leaf, in topological order, honouring progress against the data date (Task 6):
 *  - complete (actualFinish, or a milestone with any actual): placed on its actuals; logic and constraints ignored;
 *  - in progress (actualStart only): es = actual start; the remaining duration resumes at the data date
 *    (`progress_override`) or at the later of the data date and every link demand (`retained_logic`);
 *  - not started: es ≥ the data date, as one more logic demand (MSO/MFO, which ignore logic, ignore it too).
 *  `held` activities keep the given times and only drive their successors (used for ALAP, ruling 4d). */
export function forwardPass(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>, held?: Map<string, Times>): Map<string, Times> {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const projectCal = cals.get(input.defaultCalendarId)!
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  /** Duration for percent lags: always the original duration, even with a remaining duration (ruling 6(4)). */
  const durOf = (a: ActivityInput) => (isMilestone(a) ? 0 : a.originalDuration)
  const projectStart = startOf(input.projectStart)
  const progress = progressContext(input)
  const times = new Map<string, Times>()

  for (const a of n.leaves) {
    const h = held?.get(a.id)
    if (h) {
      times.set(a.id, { ...h })
      continue
    }
    const cal = calOf(a)
    const dur = plannedDuration(a, progress.active)
    const c = a.constraint
    // Ruling 1: a level_of_effort pred never drives.
    const preds = (n.predsOf.get(a.id) ?? []).filter(l => byId.get(l.predId)!.type !== 'level_of_effort')

    if (a.type === 'level_of_effort') {
      times.set(a.id, { es: projectStart, ef: projectStart })
      continue
    }
    if (a.type === 'module_summary') {
      times.set(a.id, { es: startOf(a.fixed!.start), ef: startOf(a.fixed!.finish) + 1 })
      continue
    }

    const state = progress.active ? progressState(a) : 'not_started'
    // The data date as a working start on this activity's calendar (dd = snapStart(startOf(dataDate))).
    const dd = progress.active ? cal.snapStart(progress.dataDate) : projectStart

    if (state === 'complete') {
      if (isMilestone(a)) {
        times.set(a.id, completedMilestone(a))
        continue
      }
      const ef = startOf(a.actualFinish!) + 1
      // Ruling 6(5): with no actual start, the start is derived back from the actual finish by the original duration.
      const es = a.actualStart !== null ? startOf(a.actualStart) : cal.snapStart(cal.addWork(ef, -a.originalDuration, 'start'))
      times.set(a.id, { es, ef })
      continue
    }
    if (state === 'in_progress') {
      // Only tasks get here: a milestone with an actual date is complete.
      // Ruling 6(1): it has started, so SNET/SNLT/MSO are ignored; FNET/MFO still bind the remaining part.
      const es = startOf(a.actualStart!)
      const remaining = remainingFrom(a, cal, es, dd)
      /** The remaining part must finish no earlier than `f` (a finish boundary). */
      const finishFloor = (f: Instant) => cal.addWork(f, -remaining, 'start')
      let resume = Math.max(es, dd)
      if (c?.type === 'mfo') {
        resume = Math.max(resume, finishFloor(startOf(c.date!) + 1)) // logic ignored; never before dd
      } else {
        if (input.options.progress === 'retained_logic') {
          for (const link of preds) {
            const pred = byId.get(link.predId)!
            const d = linkDemand(link, times.get(pred.id)!, calOf(pred), cal, projectCal, durOf(pred))
            resume = Math.max(resume, d.on === 'start' ? d.at : finishFloor(d.at))
          }
        }
        if (c?.type === 'fnet') resume = Math.max(resume, finishFloor(startOf(c.date!) + 1))
      }
      resume = cal.snapStart(resume)
      // addWork(resume, 0, 'finish') would land before resume, so a task with nothing left ends at resume.
      times.set(a.id, { es, ef: remaining === 0 ? resume : cal.addWork(resume, remaining, 'finish') })
      continue
    }

    if (isMilestone(a)) {
      // Ruling 3: one moment m with a display kind. Each demand is start-type or finish-type.
      const demands: Array<{ at: Instant; kind: MomentKind }> = []
      const startType = (t: Instant) => { demands.push({ at: cal.snapStart(t), kind: 'start' }) }
      const finishType = (t: Instant) => {
        if (a.type === 'start_milestone') demands.push({ at: cal.snapStart(t), kind: 'start' })
        else demands.push({ at: t, kind: 'finish' })
      }
      // A start_milestone treats FNET/MFO as SNET/MSO on the same date.
      const dateDemand = (type: 'snet' | 'mso' | 'fnet' | 'mfo', date: CalendarDate) => {
        if (type === 'snet' || type === 'mso' || a.type === 'start_milestone') startType(startOf(date))
        else finishType(startOf(date) + 1)
      }

      if (c?.type === 'mso' || c?.type === 'mfo') {
        dateDemand(c.type, c.date!) // logic ignored
        // Ruling 6(2): never before the data date, even under MSO/MFO (shows as negative float).
        if (progress.active) startType(dd)
      } else {
        startType(projectStart)
        if (progress.active) startType(dd)
        for (const link of preds) {
          const pred = byId.get(link.predId)!
          const pt = times.get(pred.id)!
          const finishBased = link.type === 'FS' || link.type === 'FF'
          const at = applyLag(link, finishBased ? pt.ef : pt.es, finishBased ? 'finish' : 'start',
            calOf(pred), cal, projectCal, durOf(pred))
          if (finishBased) finishType(at)
          else startType(at)
        }
        if (c?.type === 'snet' || c?.type === 'fnet') dateDemand(c.type, c.date!)
      }
      let m = demands[0]
      for (const d of demands) {
        if (d.at > m.at || (d.at === m.at && d.kind === 'finish')) m = d
      }
      times.set(a.id, { es: m.at, ef: m.at, kind: m.kind })
      continue
    }

    /** Place the task so it starts at `es` (a working start).
     *  addWork(es, 0, 'finish') would land BEFORE es, so a zero-length task keeps ef = es. */
    const fromStart = (es: Instant): Times => (dur === 0 ? { es, ef: es } : { es, ef: cal.addWork(es, dur, 'finish') })
    /** Place the task so it finishes at `ef`. */
    const fromFinish = (ef: Instant): Times => fromStart(cal.snapStart(cal.addWork(ef, -dur, 'start')))

    if (c?.type === 'mso' || c?.type === 'mfo') {
      // Logic ignored. Ruling 6(2): never before the data date; the conflict shows as negative float.
      const t = mandatoryTimes(a, cal, dur)
      times.set(a.id, progress.active && cal.workPos(t.es) < cal.workPos(dd) ? fromStart(dd) : t)
      continue
    }

    let startDemand = Math.max(projectStart, dd)
    for (const link of preds) {
      const pred = byId.get(link.predId)!
      const d = linkDemand(link, times.get(pred.id)!, calOf(pred), cal, projectCal, durOf(pred))
      startDemand = Math.max(startDemand, d.on === 'start' ? d.at : cal.addWork(d.at, -dur, 'start'))
    }
    let t = fromStart(cal.snapStart(startDemand))

    if (c?.type === 'snet') {
      const floor = cal.snapStart(startOf(c.date!))
      if (t.es < floor) t = fromStart(floor)
    } else if (c?.type === 'fnet') {
      const floor = startOf(c.date!) + 1
      if (t.ef < floor) t = fromFinish(floor)
    }
    times.set(a.id, t)
  }
  return times
}
