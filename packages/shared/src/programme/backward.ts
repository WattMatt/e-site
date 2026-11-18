/**
 * Backward pass, late dates and ALAP. Call order (Task 7):
 *   1. early = forwardPass(n, input, cals)
 *   2. { late, projectFinish, projectFinishDate } = backwardPass(n, input, cals, early) — projectFinish is
 *      null when there is no leaf other than level-of-effort (ruling 14)
 *   3. tf = totalFloats(n, input, cals, early, late); ff = freeFloats(n, input, cals, early, late, projectFinish)
 *      — floats come from the PRE-ALAP early dates (ruling 5b)
 *   4. applyAlap(n, input, cals, early, late) — replaces entries in `early` (post-ALAP display dates)
 *   5. issues = scheduleWarnings(n, input, cals, early, tf)
 * applyAlap replaces map entries and never mutates the Times objects, so `new Map(early)` taken before
 * step 4 keeps the pre-ALAP dates if they are needed afterwards.
 */
import { displayFinish, startOf, type EngineCalendar } from './calendar'
import { displayMilestone, forwardPass, lagDuration, mandatoryTimes, plannedDuration, progressContext, progressState, remainingFrom, type MomentKind, type Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, CalendarDate, DependencyInput, Instant, ProgrammeInput } from './types'

const EPS = 1e-9

/** `kind` is set for milestones only: how their single late moment (ls = lf) is displayed (ruling 3). */
export interface LateTimes { ls: Instant; lf: Instant; kind?: MomentKind }

export const isMilestone = (a: ActivityInput) => a.type === 'start_milestone' || a.type === 'finish_milestone'
/** Duration for percent lags (see `lagDuration`). */
export const durationOf = (a: ActivityInput, cal: EngineCalendar) => lagDuration(a, cal)
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
  cals: Map<string, EngineCalendar>, early: Map<string, Times>):
  { late: Map<string, LateTimes>; projectFinish: Instant | null; projectFinishDate: CalendarDate | null } {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const projectCal = cals.get(input.defaultCalendarId)!
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  const projectStart = startOf(input.projectStart)
  const progress = progressContext(input)

  // Ruling 12(a, b): each finish is canonicalised on the activity's OWN calendar (a task: the end of its last
  // working day; a milestone: its moment), and projectFinish is the numerically greatest of them. Its
  // displayed date is the displayed finish of the activity that set it; on an equal instant, the latest one.
  // Level-of-effort placeholders never set it. With no other leaf it is null (ruling 14).
  let projectFinish: Instant | null = null
  let projectFinishDate: CalendarDate | null = null
  for (const a of n.leaves) {
    if (a.type === 'level_of_effort') continue
    const t = early.get(a.id)!
    const cal = calOf(a)
    const milestone = isMilestone(a)
    const f = milestone ? t.ef : cal.fromWorkPos(cal.workPos(t.ef), 'finish')
    const shown = milestone ? displayMilestone(cal, f, t.kind ?? (a.type === 'start_milestone' ? 'start' : 'finish'))
      : displayFinish(cal, f)
    if (projectFinish === null || f > projectFinish + EPS) {
      projectFinish = f
      projectFinishDate = shown
    } else if (Math.abs(f - projectFinish) <= EPS && shown > projectFinishDate!) {
      projectFinishDate = shown
    }
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
    if (a.type === 'module_summary' || state === 'complete') {
      late.set(a.id, e.kind ? { ls: e.es, lf: e.ef, kind: e.kind } : { ls: e.es, lf: e.ef })
      continue
    }

    const cal = calOf(a)
    const c = a.constraint
    if (state === 'in_progress' && c?.type === 'mfo') {
      // Ruling 6(1): an MFO still fixes the finish of a started task; its start stays the actual start.
      late.set(a.id, { ls: e.es, lf: startOf(c.date!) + 1 })
      continue
    }
    if (state === 'not_started' && isFixed(a)) {
      // MSO/MFO fix the late side at the constraint date, even when the data date pushed the early side
      // later (ruling 6(2)): that conflict is negative float. Without progress this equals the early dates.
      const t = mandatoryTimes(a, cal, plannedDuration(a, progress.active))
      late.set(a.id, t.kind ? { ls: t.es, lf: t.ef, kind: t.kind } : { ls: t.es, lf: t.ef })
      continue
    }

    const dur = durationOf(a, cal) // for percent lags (ruling 6(4): always the original duration)
    // Duration used to place the late dates: the remaining duration for an in-progress task.
    const span = state === 'in_progress' ? remainingFrom(a, cal, e.es, cal.snapStart(progress.dataDate))
      : plannedDuration(a, progress.active)
    const succs = liveLinks(n.succsOf.get(a.id), byId)

    // Every limit as a working position on this activity's calendar. `pos` limits the start ('start')
    // or the finish ('finish'); `kind` is the milestone display kind it would give (ruling 4a: its source).
    const limits: Array<{ pos: number; on: 'start' | 'finish'; kind: MomentKind }> = []
    for (const link of succs) {
      const succ = byId.get(link.succId)!
      const sl = late.get(succ.id)!
      // Ruling 10: a completed successor never limits its predecessor (any link type, any progress mode).
      if (progress.active && progressState(succ) === 'complete') continue
      let s = sl.ls
      // Ruling 9: a start-side link (FS/SS) into an in-progress successor never limits by its actual start.
      // retained_logic: by its late resume point (lf − remaining, on its calendar); progress_override: not at all.
      if ((link.type === 'FS' || link.type === 'SS') && progress.active && progressState(succ) === 'in_progress') {
        if (input.options.progress === 'progress_override') continue
        const succCal = calOf(succ)
        const remaining = remainingFrom(succ, succCal, early.get(succ.id)!.es, succCal.snapStart(progress.dataDate))
        s = succCal.addWork(sl.lf, -remaining, 'start')
      }
      // Asymmetry, on purpose (goldens/README.md): under progress_override an FF/SF link into an in-progress
      // successor does not drive that successor in the forward pass, but it still limits this predecessor
      // here (ruling 9) and its free float (ruling 11). Only start-side links are skipped above.
      const { on, at } = linkLimit(link, { s, f: sl.lf }, cal, calOf(succ), projectCal, dur)
      limits.push({ pos: cal.workPos(at), on, kind: on })
    }
    // Ruling 4(b) / 12(c): every activity's late finish is capped at projectFinish, successors or not.
    // Ruling 12(d): a milestone limited by projectFinish keeps its OWN early kind. (Non-null here: this
    // activity is a non-LOE leaf, so it took part in choosing projectFinish.)
    limits.push({ pos: cal.workPos(projectFinish!), on: 'finish', kind: e.kind ?? 'finish' })
    // Ruling 6(1): a started task ignores SNLT (start-side); FNLT and a deadline still bind its finish.
    if (c?.type === 'snlt' && state !== 'in_progress') limits.push({ pos: cal.workPos(startOf(c.date!)), on: 'start', kind: 'start' })
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
  return { late, projectFinish, projectFinishDate }
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
