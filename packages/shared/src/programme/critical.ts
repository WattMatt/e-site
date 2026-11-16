import { isFixed } from './backward'
import type { EngineCalendar } from './calendar'
import { applyLag, lagDuration, linkDemand, plannedDuration, progressContext, progressState, remainingFrom, type Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, DependencyInput, Instant, ProgrammeInput } from './types'

const EPS = 1e-9

/**
 * The driving links, on the FINAL (post-ALAP) early dates. A link drives when what it demands of its
 * successor equals the successor's early date on that side, within 1e-9, after the same snapping the
 * forward pass applies (a start demand on a weekend boundary lands on the next working start):
 *  - a task: the start the demand alone would give, against the successor's early start;
 *  - an in-progress task (retained logic only): the same, against the point its remaining work resumes;
 *  - a milestone: the moment the demand alone would give (ruling 3), against its single moment.
 * Never driving: a link with a level_of_effort at either end (ruling 1), and a link into an activity whose
 * logic is ignored (complete, MSO/MFO, module_summary, or in progress under progress override).
 * Returned as the expanded link objects, so a summary link that drives only some leaf pairs is exact.
 */
export function drivingLinks(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>, early: Map<string, Times>): DependencyInput[] {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  const projectCal = cals.get(input.defaultCalendarId)!
  const progress = progressContext(input)
  const out: DependencyInput[] = []

  for (const link of n.links) {
    const pred = byId.get(link.predId)!
    const succ = byId.get(link.succId)!
    if (pred.type === 'level_of_effort' || succ.type === 'level_of_effort') continue
    const state = progress.active ? progressState(succ) : 'not_started'
    if (state === 'complete' || succ.type === 'module_summary') continue
    if (state === 'in_progress' && (succ.constraint?.type === 'mfo' || input.options.progress === 'progress_override')) continue
    if (state === 'not_started' && isFixed(succ)) continue

    const cal = calOf(succ)
    const predCal = calOf(pred)
    const pt = early.get(pred.id)!
    const st = early.get(succ.id)!
    const predDur = lagDuration(pred, predCal)

    let candidate: Instant
    let target: Instant
    if (succ.type === 'start_milestone' || succ.type === 'finish_milestone') {
      const finishBased = link.type === 'FS' || link.type === 'FF'
      const at = applyLag(link, finishBased ? pt.ef : pt.es, finishBased ? 'finish' : 'start', predCal, cal, projectCal, predDur)
      candidate = succ.type === 'finish_milestone' && finishBased ? at : cal.snapStart(at)
      target = st.es
    } else {
      const d = linkDemand(link, pt, predCal, cal, projectCal, predDur)
      if (state === 'in_progress') {
        const remaining = remainingFrom(succ, cal, st.es, cal.snapStart(progress.dataDate))
        target = remaining === 0 ? st.ef : cal.fromWorkPos(cal.workPos(st.ef) - remaining, 'start')
        candidate = cal.snapStart(d.on === 'start' ? d.at : cal.addWork(d.at, -remaining, 'start'))
      } else {
        const dur = plannedDuration(succ, progress.active)
        target = st.es
        candidate = cal.snapStart(d.on === 'start' ? d.at : cal.addWork(d.at, -dur, 'start'))
      }
    }
    if (Math.abs(candidate - target) <= EPS) out.push(link)
  }
  return out
}

/** Whether an activity may be marked critical: never a completed one, a level_of_effort or a summary. */
function eligible(a: ActivityInput, progressActive: boolean): boolean {
  if (a.type === 'level_of_effort' || a.type === 'summary') return false
  return !(progressActive && progressState(a) === 'complete')
}

/**
 * Critical leaves.
 *  - `total_float`: TF ≤ threshold (TF from the pre-ALAP early dates, unrounded).
 *  - `longest_path`: walk the driving links backwards from every non-LOE activity whose final early finish
 *    is at the project finish's working position on the default calendar (within 1e-9, ruling 7(1): a start
 *    moment at Monday 00:00 ties with Friday's end); every activity reached is critical.
 * Completed activities, level_of_effort and summaries are never critical.
 */
export function criticalIds(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, tf: Map<string, number>, driving: DependencyInput[], projectFinish: Instant): Set<string> {
  const progressActive = progressContext(input).active
  const out = new Set<string>()
  const opt = input.options.critical
  if (opt.kind === 'total_float') {
    for (const a of n.leaves) {
      if (eligible(a, progressActive) && tf.get(a.id)! <= opt.threshold + EPS) out.add(a.id)
    }
    return out
  }
  const predsOf = drivingPredsOf(driving)
  const projectCal = cals.get(input.defaultCalendarId)!
  const pfPos = projectCal.workPos(projectFinish)
  const reached = new Set<string>()
  const stack: string[] = []
  for (const a of n.leaves) {
    if (a.type === 'level_of_effort') continue
    if (Math.abs(projectCal.workPos(early.get(a.id)!.ef) - pfPos) <= EPS) {
      reached.add(a.id)
      stack.push(a.id)
    }
  }
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const l of predsOf.get(id) ?? []) {
      if (reached.has(l.predId)) continue
      reached.add(l.predId)
      stack.push(l.predId)
    }
  }
  for (const a of n.leaves) {
    if (reached.has(a.id) && eligible(a, progressActive)) out.add(a.id)
  }
  return out
}

/** Driving links grouped by successor, in link order. */
export function drivingPredsOf(driving: DependencyInput[]): Map<string, DependencyInput[]> {
  const m = new Map<string, DependencyInput[]>()
  for (const l of driving) {
    const list = m.get(l.succId)
    if (list) list.push(l)
    else m.set(l.succId, [l])
  }
  return m
}

/** The driving chain into `targetId`, from the activity that starts it (one with no driving predecessor)
 *  to the target, in order. Where several links drive an activity, the first in link order is followed. */
export function traceDrivingPath(predsOf: Map<string, DependencyInput[]>, targetId: string):
  { activityIds: string[]; dependencyIds: string[] } {
  const activityIds = [targetId]
  const dependencyIds: string[] = []
  const seen = new Set([targetId])
  let cur = targetId
  for (;;) {
    const l = (predsOf.get(cur) ?? []).find(x => !seen.has(x.predId))
    if (!l) break
    seen.add(l.predId)
    activityIds.push(l.predId)
    dependencyIds.push(l.id)
    cur = l.predId
  }
  return { activityIds: activityIds.reverse(), dependencyIds: dependencyIds.reverse() }
}
