import type { ArchetypeShapeDef } from './archetypes'
import { dayTypeOf, HOURS_PER_YEAR, referenceYearDates, type DayType } from './calendar'
import type { DailyHours } from './hourly'

export interface SynthTenantInput {
  areaM2: number
  densityWPerM2: number
  /** An expanded shape (expandArchetype) for the same reference year. */
  shape: Float64Array
  /** Beneficial-occupation date (YYYY-MM-DD); load is 0 before it in year 1 (engine spec §2.4). */
  boDate?: string | null
}

export function synthesiseTenant(t: SynthTenantInput, referenceYear: number): Float64Array {
  const out = new Float64Array(HOURS_PER_YEAR)
  const k = (t.areaM2 * t.densityWPerM2) / 1000
  referenceYearDates(referenceYear).forEach((date, di) => {
    if (t.boDate && date < t.boDate) return
    for (let h = 0; h < 24; h++) out[di * 24 + h] = k * t.shape[di * 24 + h]
  })
  return out
}

const TYPES: DayType[] = ['weekday', 'saturday', 'sunday', 'holiday']
const mean = (xs: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]
  return xs.length ? s / xs.length : 0
}

/**
 * A meter with < 30 days of data is only a SHAPE sample (engine spec §2.2): its day-type profiles
 * replace the archetype's; day types it never saw borrow the archetype's profile scaled by the
 * ratio of sample to archetype means over the day types both have. Magnitude still comes from
 * area × density when the result is expanded and synthesised.
 */
export function shapeFromSample(sample: DailyHours, archetype: ArchetypeShapeDef): ArchetypeShapeDef {
  const sums: Partial<Record<DayType, { sum: Float64Array; n: number }>> = {}
  for (const [date, v] of sample) {
    if (v.some((x) => Number.isNaN(x))) continue
    const t = dayTypeOf(date)
    const e = sums[t] ?? { sum: new Float64Array(24), n: 0 }
    for (let h = 0; h < 24; h++) e.sum[h] += v[h]
    e.n++
    sums[t] = e
  }
  const have = TYPES.filter((t) => sums[t])
  if (have.length === 0) return archetype
  const sampled = Object.fromEntries(have.map((t) => [t, Array.from(sums[t]!.sum, (x) => x / sums[t]!.n)])) as Partial<Record<DayType, number[]>>
  const denom = mean(have.map((t) => mean(archetype.profiles[t])))
  const ratio = denom > 0 ? mean(have.map((t) => mean(sampled[t]!))) / denom : 1
  const profiles = Object.fromEntries(TYPES.map((t) => [t, sampled[t] ?? archetype.profiles[t].map((v) => v * ratio)])) as Record<DayType, number[]>
  return { profiles, operating: archetype.operating, seasonal: archetype.seasonal }
}
