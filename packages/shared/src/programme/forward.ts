import { displayFinish, displayStart, startOf, type EngineCalendar } from './calendar'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, CalendarDate, DependencyInput, Instant, ProgrammeInput } from './types'

export type MomentKind = 'start' | 'finish'
/** `kind` is set for milestones only: how their single moment (es = ef) is displayed (ruling 3). */
export interface Times { es: Instant; ef: Instant; kind?: MomentKind }

export function displayMilestone(cal: EngineCalendar, t: Instant, kind: MomentKind): CalendarDate {
  return kind === 'start' ? displayStart(t) : displayFinish(cal, t)
}

const isMilestone = (a: ActivityInput) => a.type === 'start_milestone' || a.type === 'finish_milestone'

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

/** Early dates for every leaf, in topological order. No progress (Task 6). */
export function forwardPass(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>): Map<string, Times> {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const projectCal = cals.get(input.defaultCalendarId)!
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  const durOf = (a: ActivityInput) => (isMilestone(a) ? 0 : a.originalDuration)
  const projectStart = startOf(input.projectStart)
  const times = new Map<string, Times>()

  for (const a of n.leaves) {
    const cal = calOf(a)
    const dur = durOf(a)
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
      } else {
        startType(projectStart)
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

    if (c?.type === 'mso') {
      times.set(a.id, fromStart(cal.snapStart(startOf(c.date!))))
      continue
    }
    if (c?.type === 'mfo') {
      times.set(a.id, fromFinish(startOf(c.date!) + 1))
      continue
    }

    let startDemand = projectStart
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
