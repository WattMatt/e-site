import { linkLimit, type LateTimes } from './backward'
import { startOf, type EngineCalendar } from './calendar'
import { lagDuration, linkDemand, type Times } from './forward'
import type { NormalisedProgramme } from './normalise'
import type { ActivityInput, Instant, ProgrammeInput } from './types'

/**
 * Span of every level_of_effort from its neighbours' FINAL (post-ALAP) early times (ruling 1: it never
 * drives anything, so this runs after the passes):
 *  - es = the earliest demand of its predecessors (no predecessor: the project start, snapped to work);
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
      es = Math.min(es, d.at)
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

export interface RolledUp { es: Instant; ef: Instant; ls: Instant; lf: Instant; tf: number }

/** Summary roll-up, children before parents: es = min of the children's es, ef = max of their ef, late
 *  dates the same way, TF = min of the children's TF (FF is 0). A summary with no children sits at the
 *  project start with TF 0. */
export function rollUpSummaries(n: NormalisedProgramme, input: ProgrammeInput, early: Map<string, Times>,
  late: Map<string, LateTimes>, tf: Map<string, number>): Map<string, RolledUp> {
  const out = new Map<string, RolledUp>()
  for (const s of n.summaries) {
    const r: RolledUp = { es: Infinity, ef: -Infinity, ls: Infinity, lf: -Infinity, tf: Infinity }
    for (const id of n.childrenOf.get(s.id) ?? []) {
      const child = out.get(id)
      const c = child ?? (() => {
        const e = early.get(id)!
        const l = late.get(id)!
        return { es: e.es, ef: e.ef, ls: l.ls, lf: l.lf, tf: tf.get(id)! }
      })()
      r.es = Math.min(r.es, c.es)
      r.ef = Math.max(r.ef, c.ef)
      r.ls = Math.min(r.ls, c.ls)
      r.lf = Math.max(r.lf, c.lf)
      r.tf = Math.min(r.tf, c.tf)
    }
    if (r.tf === Infinity) {
      const p = startOf(input.projectStart)
      out.set(s.id, { es: p, ef: p, ls: p, lf: p, tf: 0 })
    } else {
      out.set(s.id, r)
    }
  }
  return out
}
