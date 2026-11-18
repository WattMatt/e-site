import { describe, expect, it } from 'vitest'
import { buildEngineCalendar, displayFinish, startOf, type EngineCalendar } from './calendar'
import { scheduleProgramme } from './schedule'
import { mulberry32, randomProgramme } from './test-utils/random-programme'
import type { Instant, ProgrammeInput, ScheduleResult } from './types'

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)
const SIZE = { activities: 50, links: 90, allowConstraints: false }

/** Order-free snapshot of a result, for deep equality. */
function snapshot(r: ScheduleResult) {
  return {
    ok: r.ok,
    projectFinish: r.projectFinish,
    activities: [...r.activities.values()].sort((a, b) => a.id.localeCompare(b.id)),
    drivingLinkIds: [...r.drivingLinkIds].sort(),
    issues: r.issues.map(i => ({ ...i, activityIds: [...i.activityIds].sort(), dependencyIds: [...i.dependencyIds].sort() }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }
}

function shuffled<T>(xs: T[], rnd: () => number): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Property 1, re-derived independently of the engine's `linkDemand`: every link's demand is worked out with
 * calendar arithmetic from the DISPLAYED dates, and must not exceed the successor's early date on its side.
 *
 * Instants from displayed dates (calendar C, whole days):
 *  - a task's early start is `startOf(earlyStart)`; its early finish is the boundary after its last day,
 *    `startOf(earlyFinish) + 1`;
 *  - a finish_milestone shown on day X is one moment: `startOf(X)` if a start-type demand won (kind start), else
 *    `startOf(X) + 1` (kind finish).
 *
 * Demands. Into a task, a link asks for a start (FS/SS: `addWork(x, lag, 'start')`) or a finish (FF/SF:
 * `addWork(x, lag, 'finish')`), with x = the pred's finish (FS/FF) or start (SS/SF). Into a milestone, ruling 3
 * classifies by the PREDECESSOR side instead: FS/FF are finish-type, `addWork(pred.ef, lag, 'finish')` kept as a
 * boundary; SS/SF and the project start are start-type, `addWork(pred.es, lag, 'start')` snapped to a working
 * start. The milestone's moment is the largest; on an equal instant finish wins. That moment (and so its kind)
 * is re-derived here and must be what the display shows.
 */
function linkDemandViolations(input: ProgrammeInput, r: ScheduleResult): string[] {
  const cal: EngineCalendar = buildEngineCalendar(input.calendars[0])
  const predsOf = new Map<string, typeof input.dependencies>()
  for (const l of input.dependencies) predsOf.set(l.succId, [...(predsOf.get(l.succId) ?? []), l])
  const times = new Map<string, { es: Instant; ef: Instant }>()
  const bad: string[] = []

  // Activity ids sort in the generator's layer order, which is a topological order.
  for (const a of [...input.activities].sort((x, y) => x.id.localeCompare(y.id))) {
    const shown = r.activities.get(a.id)!
    const milestone = a.type === 'finish_milestone'
    const demands: Array<{ on: 'start' | 'finish'; at: Instant; link: string }> = []
    for (const l of predsOf.get(a.id) ?? []) {
      const pt = times.get(l.predId)!
      const fromFinish = l.type === 'FS' || l.type === 'FF'
      const on: 'start' | 'finish' = milestone
        ? (fromFinish ? 'finish' : 'start')
        : (l.type === 'FS' || l.type === 'SS' ? 'start' : 'finish')
      const at = cal.addWork(fromFinish ? pt.ef : pt.es, l.lag, on)
      demands.push({ on, at: milestone && on === 'start' ? cal.snapStart(at) : at, link: l.id })
    }
    let t: { es: Instant; ef: Instant }
    if (milestone) {
      let win: { on: 'start' | 'finish'; at: Instant } = { on: 'start', at: cal.snapStart(startOf(input.projectStart)) }
      for (const d of demands) if (d.at > win.at || (d.at === win.at && d.on === 'finish')) win = d
      const day = startOf(shown.earlyStart)
      const m = win.on === 'start' ? day : day + 1
      if (shown.earlyStart !== shown.earlyFinish) bad.push(`${a.id}: milestone shows es ${shown.earlyStart} ≠ ef ${shown.earlyFinish}`)
      if (m !== win.at) bad.push(`${a.id}: milestone shown ${shown.earlyStart}, but its largest demand is ${win.on} at ${win.at}`)
      t = { es: m, ef: m }
    } else {
      t = { es: startOf(shown.earlyStart), ef: startOf(shown.earlyFinish) + 1 }
    }
    for (const d of demands) {
      const side = d.on === 'start' ? t.es : t.ef
      if (d.at > side + 1e-9) bad.push(`${d.link} → ${a.id}: ${d.on} demand ${d.at} > ${side}`)
    }
    times.set(a.id, t)
  }
  return bad
}

describe('property tests: 200 random programmes, 50 activities / 90 links, no constraints, no progress', () => {
  it('the generator is deterministic and fills the requested sizes', () => {
    const a = randomProgramme(7, SIZE)
    expect(randomProgramme(7, SIZE)).toEqual(a)
    expect(a.activities).toHaveLength(50)
    expect(a.dependencies).toHaveLength(90)
    expect(a.activities.some(x => x.type === 'finish_milestone')).toBe(true)
    expect(new Set(a.dependencies.map(l => l.type))).toEqual(new Set(['FS', 'SS', 'FF', 'SF']))
  })

  it('every programme schedules with no issues at all (no calendar_out_of_range, no negative float)', () => {
    for (const seed of SEEDS) {
      const r = scheduleProgramme(randomProgramme(seed, SIZE))
      expect(r.ok, `seed ${seed}`).toBe(true)
      expect(r.issues, `seed ${seed}`).toEqual([])
    }
  })

  it('1. every link demand ≤ the successor\'s early date on its side (re-derived from displayed dates)', () => {
    for (const seed of SEEDS) {
      const input = randomProgramme(seed, SIZE)
      expect(linkDemandViolations(input, scheduleProgramme(input)), `seed ${seed}`).toEqual([])
    }
  })

  it('2. every total float ≥ 0 and 3. at least one activity has TF = 0', () => {
    for (const seed of SEEDS) {
      const r = scheduleProgramme(randomProgramme(seed, SIZE))
      const tfs = [...r.activities.values()].map(a => a.totalFloat)
      expect(tfs.filter(tf => tf < 0), `seed ${seed}`).toEqual([])
      expect(tfs.some(tf => tf === 0), `seed ${seed}`).toBe(true)
    }
  })

  it('4. ef === displayFinish(addWork(startOf(es), duration, \'finish\')) for every task', () => {
    for (const seed of SEEDS) {
      const input = randomProgramme(seed, SIZE)
      const cal = buildEngineCalendar(input.calendars[0])
      const r = scheduleProgramme(input)
      for (const a of input.activities) {
        if (a.type !== 'task' || a.originalDuration <= 0) continue
        const s = r.activities.get(a.id)!
        expect(displayFinish(cal, cal.addWork(startOf(s.earlyStart), a.originalDuration, 'finish')), `seed ${seed} ${a.id}`)
          .toBe(s.earlyFinish)
      }
    }
  })

  it('5. a seeded shuffle of activities and links gives a deep-equal result', () => {
    for (const seed of SEEDS) {
      const input = randomProgramme(seed, SIZE)
      const rnd = mulberry32(seed * 7919)
      const reordered: ProgrammeInput = {
        ...input, activities: shuffled(input.activities, rnd), dependencies: shuffled(input.dependencies, rnd),
      }
      expect(snapshot(scheduleProgramme(reordered)), `seed ${seed}`).toEqual(snapshot(scheduleProgramme(input)))
    }
  })
})
