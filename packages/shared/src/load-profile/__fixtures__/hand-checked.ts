/**
 * The hand-checked dataset (E8 "done when"): calendar year 2025, 30-min kW, SAST.
 *   Mon–Fri (by weekday, holidays included) 08:00–17:00 local → 100 kW, every other slot → 20 kW.
 *   One spike: 2025-03-12 (Wed) interval 10:00–10:30 → 150 kW.
 *
 * Hand derivation (independent of the code under test):
 *   2025 starts on a Wednesday; 365 days = 52 weeks + 1 day (a Wednesday) → 261 Mon–Fri days, 104 Sat/Sun.
 *   Mon–Fri day: 9 h × 100 + 15 h × 20 = 1 200 kWh.  Sat/Sun day: 24 h × 20 = 480 kWh.
 *   Spike adds (150 − 100) kW × 0.5 h = 25 kWh.
 *   Annual = 261 × 1 200 + 104 × 480 + 25 = 313 200 + 49 920 + 25 = 363 145 kWh.
 *   Hourly-average peak = (150 + 100) / 2 = 125 kW on 2025-03-12 10:00.
 *   Load factor (hourly) = 363 145 / (125 × 8 760) = 0.331638…
 *   Interval MD (March) = 150 kW at the interval ending 10:30 → 150 / 0.95 = 157.894… kVA.
 *   Every other month: 100 kW → 105.263… kVA.
 *   NMD suggestion = ceil(157.894… × 1.10 / 5) × 5 = ceil(34.736…) × 5 = 175 kVA.
 *   January 2025 = 23 Mon–Fri + 8 Sat/Sun → 23 × 1 200 + 8 × 480 = 31 440 kWh.
 */
import { QUALITY, type Reading } from '../../meter-data/types'

export const SAST_MS = 2 * 3_600_000
export const HAND = {
  annualKwh: 363_145,
  peakKwHourly: 125,
  peakAt: '2025-03-12 10:00',
  loadFactor: 363_145 / (125 * 8760),
  mdKwMarch: 150,
  mdKvaMarch: 150 / 0.95,
  mdKvaOther: 100 / 0.95,
  nmdKva: 175,
  januaryKwh: 31_440,
} as const

/** Epoch ms (UTC) of the END of the local interval starting at y-m-d hh:mm SAST. */
export const localEnd = (y: number, m: number, d: number, hh: number, mm: number, intervalMin: number) =>
  Date.UTC(y, m - 1, d, hh, mm) - SAST_MS + intervalMin * 60_000

export function handCheckedReadings(): Reading[] {
  const out: Reading[] = []
  for (let day = new Date(Date.UTC(2025, 0, 1)); day.getUTCFullYear() === 2025; day = new Date(day.getTime() + 86_400_000)) {
    const dow = day.getUTCDay()
    const weekday = dow >= 1 && dow <= 5
    for (let slot = 0; slot < 48; slot++) {
      const hh = Math.floor(slot / 2)
      const mm = (slot % 2) * 30
      let value = weekday && hh >= 8 && hh < 17 ? 100 : 20
      if (day.getUTCMonth() === 2 && day.getUTCDate() === 12 && hh === 10 && mm === 0) value = 150
      out.push({ tsEnd: localEnd(2025, day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, 30), value, quality: QUALITY.OK })
    }
  }
  return out
}
