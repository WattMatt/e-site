/**
 * Load archetypes (engine spec §2.4, D-06). Stored as day-type profiles + monthly multipliers and
 * expanded per reference year, because a fixed 8,760 array cannot follow a given year's weekdays
 * and public holidays. The expanded shape is normalised so its mean over OPERATING hours is 1,
 * which makes A × D × shape / 1000 average D W/m² while trading.
 */
import { DEFAULT_GENERATOR_SETTINGS } from '../../generator-cost-recovery/defaults'
import type { ShopCategory } from '../../generator-cost-recovery/types'
import { dayTypeOf, HOURS_PER_YEAR, monthOf, referenceYearDates, type DayType } from './calendar'

export const ARCHETYPE_CODES = ['retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant'] as const
export type ArchetypeCode = (typeof ARCHETYPE_CODES)[number]
export type OperatingWindow = readonly [open: number, close: number] | null

export interface ArchetypeShapeDef {
  /** Relative level per hour (24 values) per day type; 1.0 = trading. */
  profiles: Record<DayType, readonly number[]>
  /** Hours [open, close) that define operating hours for normalisation; null = closed all day. */
  operating: Record<DayType, OperatingWindow>
  /** Monthly multiplier, January first (HVAC seasonality, southern hemisphere). */
  seasonal: readonly number[]
}

export interface LoadArchetype extends ArchetypeShapeDef {
  code: ArchetypeCode
  version: number
  name: string
}

const flat = (v: number): number[] => Array.from({ length: 24 }, () => v)
function block(base: number, open: number, close: number, ramp = 0.5): number[] {
  return Array.from({ length: 24 }, (_, h) => (h >= open && h < close ? 1 : h === open - 1 || h === close ? ramp : base))
}
function all<T>(v: T): Record<DayType, T> {
  return { weekday: v, saturday: v, sunday: v, holiday: v }
}
const HVAC = [1.1, 1.1, 1.05, 1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 1.05, 1.1] as const

export const LOAD_ARCHETYPES: readonly LoadArchetype[] = [
  {
    code: 'retail', version: 1, name: 'Retail (09:00-18:00 Mon-Sat)',
    profiles: { weekday: block(0.15, 9, 18), saturday: block(0.15, 9, 18), sunday: flat(0.15), holiday: flat(0.15) },
    operating: { weekday: [9, 18], saturday: [9, 18], sunday: null, holiday: null },
    seasonal: HVAC,
  },
  { code: 'fast_food', version: 1, name: 'Fast food (07:00-22:00 daily)', profiles: all(block(0.2, 7, 22)), operating: all<OperatingWindow>([7, 22]), seasonal: HVAC },
  { code: 'restaurant', version: 1, name: 'Restaurant (11:00-22:00 daily)', profiles: all(block(0.2, 11, 22)), operating: all<OperatingWindow>([11, 22]), seasonal: HVAC },
  {
    code: 'supermarket', version: 1, name: 'Supermarket (refrigeration base 35 %)',
    profiles: { weekday: block(0.35, 8, 20), saturday: block(0.35, 8, 20), sunday: block(0.35, 8, 17), holiday: block(0.35, 8, 17) },
    operating: { weekday: [8, 20], saturday: [8, 20], sunday: [8, 17], holiday: [8, 17] },
    seasonal: HVAC,
  },
  {
    code: 'office_bank', version: 1, name: 'Office / bank (07:00-18:00 Mon-Fri)',
    profiles: { weekday: block(0.1, 7, 18), saturday: flat(0.1), sunday: flat(0.1), holiday: flat(0.1) },
    operating: { weekday: [7, 18], saturday: null, sunday: null, holiday: null },
    seasonal: HVAC,
  },
  { code: 'gym', version: 1, name: 'Gym (05:00-21:00 daily)', profiles: all(block(0.1, 5, 21)), operating: all<OperatingWindow>([5, 21]), seasonal: HVAC },
  { code: 'anchor_24h', version: 1, name: 'Anchor (24 h base 60 %, trading 08:00-21:00)', profiles: all(block(0.6, 8, 21, 0.8)), operating: all<OperatingWindow>([8, 21]), seasonal: HVAC },
  { code: 'vacant', version: 1, name: 'Vacant (no load)', profiles: all(flat(0)), operating: all<OperatingWindow>(null), seasonal: Array.from({ length: 12 }, () => 1) },
]

export function getArchetype(code: ArchetypeCode): LoadArchetype {
  const a = LOAD_ARCHETYPES.find((x) => x.code === code)
  if (!a) throw new Error(`unknown archetype ${code}`)
  return a
}

export function expandArchetype(a: ArchetypeShapeDef, year: number): Float64Array {
  const out = new Float64Array(HOURS_PER_YEAR)
  let sum = 0
  let n = 0
  referenceYearDates(year).forEach((date, di) => {
    const t = dayTypeOf(date)
    const s = a.seasonal[monthOf(date) - 1]
    const w = a.operating[t]
    for (let h = 0; h < 24; h++) {
      const v = a.profiles[t][h] * s
      out[di * 24 + h] = v
      if (w && h >= w[0] && h < w[1]) {
        sum += v
        n++
      }
    }
  })
  const mean = n > 0 ? sum / n : 0
  if (mean <= 0) return new Float64Array(HOURS_PER_YEAR)
  for (let i = 0; i < out.length; i++) out[i] /= mean
  return out
}

/** D-06: seeded from the GCR category rates (kW/m² → W/m²). Average over operating hours. */
export const DEFAULT_DENSITY_W_PER_M2: Record<ShopCategory, number> = (() => {
  const w = (kwPerM2: number) => Math.round(kwPerM2 * 100_000) / 100
  const s = DEFAULT_GENERATOR_SETTINGS
  return {
    standard: w(s.standardKwPerSqm),
    fast_food: w(s.fastFoodKwPerSqm),
    restaurant: w(s.restaurantKwPerSqm),
    national: w(s.nationalKwPerSqm),
    other: w(s.standardKwPerSqm),
  }
})()

export const CATEGORY_ARCHETYPE: Record<ShopCategory, ArchetypeCode> = {
  standard: 'retail', fast_food: 'fast_food', restaurant: 'restaurant', national: 'supermarket', other: 'retail',
}
