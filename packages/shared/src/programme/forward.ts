import { startOf, type EngineCalendar } from './calendar'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, DependencyInput, Instant, ProgrammeInput } from './types'

export interface Times { es: Instant; ef: Instant }

const isMilestone = (a: ActivityInput) => a.type === 'start_milestone' || a.type === 'finish_milestone'

/** What a link asks of its successor: a start no earlier than `at`, or a finish no earlier than `at`. */
export function linkDemand(link: DependencyInput, pred: Times, predCal: EngineCalendar, succCal: EngineCalendar,
  projectCal: EngineCalendar, predDuration: number): { on: 'start' | 'finish'; at: Instant } {
  const on: 'start' | 'finish' = link.type === 'FS' || link.type === 'SS' ? 'start' : 'finish'
  const x = link.type === 'FS' || link.type === 'FF' ? pred.ef : pred.es
  const mode = on === 'start' ? 'start' : 'finish'
  let at: Instant
  if (link.lagUnit === 'elapsed_days') {
    at = x + link.lag
  } else if (link.lagUnit === 'percent') {
    at = predCal.addWork(x, (link.lag / 100) * predDuration, mode)
  } else {
    const lagCal = link.lagCalendar === 'pred' ? predCal : link.lagCalendar === 'succ' ? succCal : projectCal
    at = lagCal.addWork(x, link.lag, mode)
  }
  return { on, at }
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

    if (a.type === 'level_of_effort') {
      times.set(a.id, { es: projectStart, ef: projectStart })
      continue
    }
    if (a.type === 'module_summary') {
      times.set(a.id, { es: startOf(a.fixed!.start), ef: startOf(a.fixed!.finish) + 1 })
      continue
    }

    /** Place the activity so it starts at `es` (es already a valid start for its type). */
    // addWork(es, 0, 'finish') would land BEFORE es, so a zero-length activity keeps ef = es.
    const fromStart = (es: Instant): Times => (dur === 0 ? { es, ef: es } : { es, ef: cal.addWork(es, dur, 'finish') })
    /** Place the activity so it finishes at `ef`. */
    const fromFinish = (ef: Instant): Times => {
      if (a.type === 'finish_milestone') return { es: ef, ef }
      if (a.type === 'start_milestone') {
        const es = cal.snapStart(ef)
        return { es, ef: es }
      }
      return fromStart(cal.snapStart(cal.addWork(ef, -dur, 'start')))
    }

    const c = a.constraint
    if (c?.type === 'mso') {
      times.set(a.id, fromStart(cal.snapStart(startOf(c.date!))))
      continue
    }
    if (c?.type === 'mfo') {
      times.set(a.id, fromFinish(startOf(c.date!) + 1))
      continue
    }

    let startDemand = projectStart
    let finishDemand = -Infinity // finish_milestone only: the raw finish demands
    for (const link of n.predsOf.get(a.id) ?? []) {
      const pred = byId.get(link.predId)!
      if (pred.type === 'level_of_effort') continue
      const d = linkDemand(link, times.get(pred.id)!, calOf(pred), cal, projectCal, durOf(pred))
      if (d.on === 'start') startDemand = Math.max(startDemand, d.at)
      else if (a.type === 'finish_milestone') finishDemand = Math.max(finishDemand, d.at)
      else startDemand = Math.max(startDemand, cal.addWork(d.at, -dur, 'start'))
    }

    let t: Times = a.type === 'finish_milestone'
      ? fromFinish(Math.max(startDemand, finishDemand))
      : fromStart(cal.snapStart(startDemand))

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
