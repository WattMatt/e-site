import { linkLimit } from './backward'
import { displayStart, startOf, type EngineCalendar } from './calendar'
import { lagDuration, linkDemand, type Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, CalendarDate, ProgrammeInput } from './types'

/**
 * Span of every level_of_effort from its neighbours' FINAL (post-ALAP) early times (ruling 1: it never
 * drives anything, so this runs after the passes):
 *  - es = the earliest start-side (FS/SS) demand of its predecessors, snapped to work on its calendar
 *    (ruling 8; FF/SF predecessors do not set it; with none: the project start, snapped to work);
 *  - ef = the max of what its successors demand: each successor's date on that link's successor side,
 *    moved back by the lag (no successor, or a demand before es: ef = es).
 * Links to or from another LOE are ignored. Late times equal these early times; TF and FF are 0.
 */
export function levelOfEffortTimes(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>, early: Map<string, Times>): Map<string, Times> {
  const byId = new Map(n.leaves.map(a => [a.id, a]))
  const calOf = (a: ActivityInput) => cals.get(a.calendarId ?? input.defaultCalendarId)!
  const projectCal = cals.get(input.defaultCalendarId)!
  const isLoe = (id: string) => byId.get(id)!.type === 'level_of_effort'
  const out = new Map<string, Times>()

  for (const a of n.leaves) {
    if (a.type !== 'level_of_effort') continue
    const cal = calOf(a)
    let es = Infinity
    for (const link of n.predsOf.get(a.id) ?? []) {
      if (isLoe(link.predId)) continue
      const pred = byId.get(link.predId)!
      const d = linkDemand(link, early.get(pred.id)!, calOf(pred), cal, projectCal, lagDuration(pred, calOf(pred)))
      // Ruling 8: only start-side demands (FS/SS) set an LOE's start, snapped to work on its calendar.
      if (d.on === 'start') es = Math.min(es, cal.snapStart(d.at))
    }
    if (es === Infinity) es = cal.snapStart(startOf(input.projectStart))
    let ef = -Infinity
    for (const link of n.succsOf.get(a.id) ?? []) {
      if (isLoe(link.succId)) continue
      const succ = byId.get(link.succId)!
      const st = early.get(succ.id)!
      const l = linkLimit(link, { s: st.es, f: st.ef }, cal, calOf(succ), projectCal, lagDuration(a, cal))
      ef = Math.max(ef, l.at)
    }
    if (ef < es) ef = es
    out.set(a.id, { es, ef })
  }
  return out
}

/** Displayed dates of a leaf or a summary (ruling 13). */
export interface ShownDates { es: CalendarDate; ef: CalendarDate; ls: CalendarDate; lf: CalendarDate }
export interface RolledUp extends ShownDates { tf: number }

/** Summary roll-up, children before parents (ruling 13): a summary shows the earliest displayed start and the
 *  latest displayed finish of its non-LOE descendants, early and late alike, taken from `shown` (each leaf's
 *  displayed dates on its own calendar); never from instants on the default calendar. FF is 0. TF = min over
 *  the non-LOE descendants (ruling 7(5)). A summary with no non-LOE descendant has TF 0 and sits at the
 *  project start (snapped on the default calendar). */
export function rollUpSummaries(n: NormalisedProgramme, input: ProgrammeInput, defaultCal: EngineCalendar,
  shown: Map<string, ShownDates>, tf: Map<string, number>): Map<string, RolledUp> {
  const isLoe = new Set(n.leaves.filter(a => a.type === 'level_of_effort').map(a => a.id))
  // Over non-LOE descendants only; null while none has been seen. ISO dates compare as strings.
  const raw = new Map<string, RolledUp | null>()
  const out = new Map<string, RolledUp>()
  for (const s of n.summaries) {
    let r: RolledUp | null = null
    for (const id of n.childrenOf.get(s.id) ?? []) {
      const c = raw.has(id) ? raw.get(id)! : isLoe.has(id) ? null : { ...shown.get(id)!, tf: tf.get(id)! }
      if (c === null) continue
      if (r === null) r = { ...c }
      else {
        if (c.es < r.es) r.es = c.es
        if (c.ef > r.ef) r.ef = c.ef
        if (c.ls < r.ls) r.ls = c.ls
        if (c.lf > r.lf) r.lf = c.lf
        r.tf = Math.min(r.tf, c.tf)
      }
    }
    raw.set(s.id, r)
    if (r === null) {
      const p = displayStart(defaultCal.snapStart(startOf(input.projectStart)))
      out.set(s.id, { es: p, ef: p, ls: p, lf: p, tf: 0 })
    } else {
      out.set(s.id, r)
    }
  }
  return out
}
