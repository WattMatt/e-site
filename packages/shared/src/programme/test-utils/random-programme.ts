import { addCalendarDays } from '../../lib/dates/calendar-date'
import type { ActivityInput, ConstraintType, DependencyInput, LinkType, ProgrammeInput } from '../types'

/** Seeded PRNG (mulberry32): a deterministic stream of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LINK_TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF']
const PROJECT_START = '2026-03-02' // Monday

/**
 * A random programme on calendar `C` (Mon–Fri), project start Mon 2026-03-02, no progress, no ALAP, no LOE and
 * no summaries. Activities sit in layers and every link runs from a lower layer to a higher one, so the network
 * is a DAG. Durations are whole working days 0–10; 0 makes a `finish_milestone`. Lags are whole working days
 * −2..5 on all four link types. No pair of activities is linked twice. The calendar's coverage (2020–2045) is
 * wide enough that no `calendar_out_of_range` warning fires. With `allowConstraints`, about one activity in ten
 * gets an SNET or FNET date within the first 60 calendar days (the only constraints generated).
 */
export function randomProgramme(seed: number,
  opts: { activities: number; links: number; allowConstraints: boolean }): ProgrammeInput {
  const rnd = mulberry32(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

  const n = opts.activities
  const layerCount = Math.max(2, Math.round(Math.sqrt(n)))
  const layerOf = (i: number) => Math.floor((i * layerCount) / n)
  const layers: number[][] = Array.from({ length: layerCount }, () => [])
  const id = (i: number) => `A${String(i).padStart(5, '0')}`

  const activities: ActivityInput[] = []
  for (let i = 0; i < n; i++) {
    layers[layerOf(i)].push(i)
    const duration = int(0, 10)
    let constraint: ActivityInput['constraint'] = null
    if (opts.allowConstraints && rnd() < 0.1) {
      const type: ConstraintType = rnd() < 0.5 ? 'snet' : 'fnet'
      constraint = { type, date: addCalendarDays(PROJECT_START, int(0, 60)) }
    }
    activities.push({
      id: id(i), parentId: null, type: duration === 0 ? 'finish_milestone' : 'task',
      originalDuration: duration, remainingDuration: null, calendarId: null,
      constraint, deadline: null, actualStart: null, actualFinish: null, fixed: null,
    })
  }

  const dependencies: DependencyInput[] = []
  const seen = new Set<string>()
  // Successors are mostly in the next few layers, which keeps the longest path (and the dates) realistic.
  for (let attempts = 0; dependencies.length < opts.links && attempts < opts.links * 20; attempts++) {
    const predLayer = int(0, layerCount - 2)
    const succLayer = Math.min(layerCount - 1, predLayer + 1 + Math.floor(rnd() * rnd() * 4))
    const p = layers[predLayer][int(0, layers[predLayer].length - 1)]
    const s = layers[succLayer][int(0, layers[succLayer].length - 1)]
    const key = `${p}>${s}`
    if (seen.has(key)) continue
    seen.add(key)
    dependencies.push({
      id: `L${String(dependencies.length).padStart(5, '0')}`, predId: id(p), succId: id(s),
      type: LINK_TYPES[int(0, 3)], lag: int(-2, 5), lagUnit: 'working_days', lagCalendar: 'succ',
    })
  }

  return {
    projectStart: PROJECT_START,
    dataDate: null,
    defaultCalendarId: 'C',
    calendars: [{
      id: 'C', workWeekdays: [1, 2, 3, 4, 5], hoursPerDay: 8, nonWorkDates: [], workDates: [],
      coverage: { from: '2020-01-01', to: '2045-12-31' },
    }],
    activities,
    dependencies,
    options: { rules: 'msp', progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'smallest' },
  }
}
