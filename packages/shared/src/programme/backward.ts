/**
 * Backward pass, late dates and ALAP. Call order (Task 7):
 *   1. early = forwardPass(n, input, cals)
 *   2. { late, projectFinish } = backwardPass(n, input, cals, early)
 *   3. tf = totalFloats(n, input, cals, early, late); ff = freeFloats(n, input, cals, early, late, projectFinish)
 *      — floats come from the PRE-ALAP early dates (ruling 5b)
 *   4. applyAlap(n, input, cals, early, late) — replaces entries in `early` (post-ALAP display dates)
 *   5. issues = scheduleWarnings(n, input, cals, early, tf)
 * applyAlap replaces map entries and never mutates the Times objects, so `new Map(early)` taken before
 * step 4 keeps the pre-ALAP dates if they are needed afterwards.
 */
import { startOf, type EngineCalendar } from './calendar'
import { forwardPass, plannedDuration, progressContext, progressState, remainingFrom, type MomentKind, type Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, DependencyInput, Instant, ProgrammeInput } from './types'

/** `kind` is set for milestones only: how their single late moment (ls = lf) is displayed (ruling 3). */
export interface LateTimes { ls: Instant; lf: Instant; kind?: MomentKind }

export const isMilestone = (a: ActivityInput) => a.type === 'start_milestone' || a.type === 'finish_milestone'
export const durationOf = (a: ActivityInput) => (isMilestone(a) ? 0 : a.originalDuration)
/** Fixed in both passes: MSO, MFO and module_summary. */
export const isFixed = (a: ActivityInput) =>
  a.type === 'module_summary' || a.constraint?.type === 'mso' || a.constraint?.type === 'mfo'

/** A link with a level_of_effort at either end never drives anything (ruling 1). */
export function liveLinks(links: DependencyInput[] | undefined, byId: Map<string, ActivityInput>): DependencyInput[] {
  return (links ?? []).filter(l =>
    byId.get(l.predId)!.type !== 'level_of_effort' && byId.get(l.succId)!.type !== 'level_of_effort')
}

/** The mirror of `linkDemand`: the latest the pred's start ('start') or finish ('finish') may be,
 *  given the successor's dates `succ` ({ s, f }), moved back by the lag on the lag calendar. */
export function linkLimit(link: DependencyInput, succ: { s: Instant; f: Instant }, predCal: EngineCalendar,
  succCal: EngineCalendar, projectCal: EngineCalendar, predDuration: number): { on: 'start' | 'finish'; at: Instant } {
  const on: 'start' | 'finish' = link.type === 'FS' || link.type === 'FF' ? 'finish' : 'start'
  const y = link.type === 'FS' || link.type === 'SS' ? succ.s : succ.f
  let at: Instant
  if (link.lagUnit === 'elapsed_days') at = y - link.lag
  else if (link.lagUnit === 'percent') at = predCal.addWork(y, -(link.lag / 100) * predDuration, on)
  else {
    const lagCal = link.lagCalendar === 'pred' ? predCal : link.lagCalendar === 'succ' ? succCal : projectCal
    at = lagCal.addWork(y, -link.lag, on)
  }
  return { on, at }
}

/** Late dates for every leaf, in reverse topological order. Progress (Task 6): a complete activity's late
 *  dates are its actuals (like MSO/MFO); an in-progress task keeps ls = es (it has started) and gets lf from
 *  the usual limits on its remaining duration (es → ef in the forward pass); a not-started task uses
 *  `remainingDuration ?? originalDuration` when progress is in play. */
export function backwardPass(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>, early: Map<string, Times>): { late: Map<string, LateTimes>; projectFinish: Instant } {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const projectCal = cals.get(input.defaultCalendarId)!
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  const projectStart = startOf(input.projectStart)
  const progress = progressContext(input)

  let projectFinish = -Infinity
  for (const t of early.values()) projectFinish = Math.max(projectFinish, t.ef)
  // Ruling 4(a): a limit from projectFinish takes the early kind of what set it ('finish' for tasks; ties → 'finish').
  let pfKind: MomentKind | null = null
  for (const a of n.leaves) {
    const t = early.get(a.id)!
    if (a.type === 'level_of_effort' || t.ef !== projectFinish) continue
    if (t.kind === 'start' && pfKind === null) pfKind = 'start'
    else if (t.kind !== 'start') pfKind = 'finish'
  }

  const late = new Map<string, LateTimes>()
  for (let i = n.leaves.length - 1; i >= 0; i--) {
    const a = n.leaves[i]
    const e = early.get(a.id)!

    if (a.type === 'level_of_effort') {
      late.set(a.id, { ls: projectStart, lf: projectStart }) // placeholder; Task 7 replaces it
      continue
    }
    const state = progress.active ? progressState(a) : 'not_started'
    if (isFixed(a) || state === 'complete') {
      late.set(a.id, e.kind ? { ls: e.es, lf: e.ef, kind: e.kind } : { ls: e.es, lf: e.ef })
      continue
    }

    const cal = calOf(a)
    const dur = durationOf(a) // for percent lags
    // Duration used to place the late dates: the remaining duration for an in-progress task.
    const span = state === 'in_progress' ? remainingFrom(a, cal, e.es, cal.snapStart(progress.dataDate))
      : plannedDuration(a, progress.active)
    const c = a.constraint
    const succs = liveLinks(n.succsOf.get(a.id), byId)

    // Every limit as a working position on this activity's calendar. `pos` limits the start ('start')
    // or the finish ('finish'); `kind` is the milestone display kind it would give (ruling 4a: its source).
    const limits: Array<{ pos: number; on: 'start' | 'finish'; kind: MomentKind }> = []
    for (const link of succs) {
      const succ = byId.get(link.succId)!
      const sl = late.get(succ.id)!
      const { on, at } = linkLimit(link, { s: sl.ls, f: sl.lf }, cal, calOf(succ), projectCal, dur)
      limits.push({ pos: cal.workPos(at), on, kind: on })
    }
    // Ruling 4(b): every activity's late finish is capped at projectFinish, successors or not.
    limits.push({ pos: cal.workPos(projectFinish), on: 'finish', kind: pfKind ?? 'finish' })
    if (c?.type === 'snlt') limits.push({ pos: cal.workPos(startOf(c.date!)), on: 'start', kind: 'start' })
    if (c?.type === 'fnlt') limits.push({ pos: cal.workPos(startOf(c.date!) + 1), on: 'finish', kind: 'finish' })
    if (a.deadline) limits.push({ pos: cal.workPos(startOf(a.deadline) + 1), on: 'finish', kind: 'finish' })

    if (a.type === 'start_milestone') {
      // Everything is a start moment; FNLT and a deadline act as SNLT on the same date.
      let pos = Infinity
      for (const l of limits) pos = Math.min(pos, l.pos)
      if (c?.type === 'fnlt') pos = Math.min(pos, cal.workPos(startOf(c.date!)))
      if (a.deadline) pos = Math.min(pos, cal.workPos(startOf(a.deadline)))
      const m = cal.fromWorkPos(pos, 'start')
      late.set(a.id, { ls: m, lf: m, kind: 'start' })
      continue
    }
    if (a.type === 'finish_milestone') {
      let best = limits[0]
      for (const l of limits) {
        if (l.pos < best.pos || (l.pos === best.pos && l.kind === 'finish')) best = l
      }
      const m = cal.fromWorkPos(best.pos, best.kind)
      late.set(a.id, { ls: m, lf: m, kind: best.kind })
      continue
    }

    // Task: the latest finish is the min of the finish limits and each start limit + duration.
    let lfPos = Infinity
    for (const l of limits) lfPos = Math.min(lfPos, l.on === 'finish' ? l.pos : l.pos + span)
    if (state === 'in_progress') {
      // Started: the late start is fixed at the actual start; only the finish floats.
      late.set(a.id, { ls: e.es, lf: span === 0 ? cal.fromWorkPos(lfPos, 'start') : cal.fromWorkPos(lfPos, 'finish') })
      continue
    }
    if (span === 0) {
      // fromWorkPos(…, 'finish') would land on the previous boundary; keep the forward pass's shape (ls = lf).
      const t = cal.fromWorkPos(lfPos, 'start')
      late.set(a.id, { ls: t, lf: t })
      continue
    }
    late.set(a.id, { ls: cal.fromWorkPos(lfPos - span, 'start'), lf: cal.fromWorkPos(lfPos, 'finish') })
  }
  return { late, projectFinish }
}

/** ALAP activities sit on their late dates (or their early dates, if later: ruling 5a); then the forward pass is re-run for everything else with them
 *  held fixed, so their successors respect logic (ruling 4d). Late dates are not recomputed. Mutates `early`. */
export function applyAlap(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, late: Map<string, LateTimes>): void {
  const held = new Map<string, Times>()
  for (const a of n.leaves) {
    if (a.constraint?.type !== 'alap' || a.type === 'level_of_effort' || a.type === 'module_summary') continue
    // A started or finished activity stays where its progress puts it.
    if (a.actualStart !== null || a.actualFinish !== null) continue
    // Ruling 5(a): the later of early and late by working position, so an ALAP activity with negative
    // float never moves before what its predecessors allow. On a tie the late time is kept.
    const cal = cals.get(a.calendarId ?? input.defaultCalendarId)!
    const e = early.get(a.id)!
    const l = late.get(a.id)!
    const useEarly = cal.workPos(e.es) > cal.workPos(l.ls)
    const es = useEarly ? e.es : l.ls
    const ef = cal.workPos(e.ef) > cal.workPos(l.lf) ? e.ef : l.lf
    const kind = useEarly ? e.kind : l.kind
    held.set(a.id, kind ? { es, ef, kind } : { es, ef })
  }
  if (held.size === 0) return
  for (const [id, t] of forwardPass(n, input, cals, held)) early.set(id, t)
}
