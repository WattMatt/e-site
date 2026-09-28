/**
 * Maximum demand after solar (engine spec §4, §2.6).
 *
 * The hour's net PV/battery contribution (load − import, negative while grid-charging) is
 * spread evenly across that hour's sub-intervals and subtracted from the measured sub-hourly
 * load — a documented, conservative approximation. The averaged hourly profile's peak is never
 * used as MD. `sub` must be on the same basis as `flows.load` (e.g. both after the case load
 * adjustment) — `simulateCase` guarantees this.
 */
import { HOURS_PER_YEAR, monthOfHour } from '../time'

export type IntervalMinutes = 5 | 15 | 30 | 60

export interface SubHourlyLoad {
  intervalMin: IntervalMinutes
  /** Average kW per interval, 8760 × (60 / intervalMin) values. */
  kw: Float64Array
}

function perHour(sub: SubHourlyLoad): number {
  const k = 60 / sub.intervalMin
  if (sub.kw.length !== HOURS_PER_YEAR * k) {
    throw new Error(`sub-hourly load at ${sub.intervalMin} min must have ${HOURS_PER_YEAR * k} values, got ${sub.kw.length}`)
  }
  return k
}

export function subHourlyAfterSolar(
  sub: SubHourlyLoad,
  flows: { load: Float64Array; import: Float64Array },
): SubHourlyLoad {
  const k = perHour(sub)
  const out = new Float64Array(sub.kw.length)
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const offset = flows.load[h]! - flows.import[h]!
    for (let j = 0; j < k; j++) out[h * k + j] = Math.max(0, sub.kw[h * k + j]! - offset)
  }
  return { intervalMin: sub.intervalMin, kw: out }
}

/**
 * Monthly maximum demand in kVA = max interval kW / power factor, over intervals whose hour is
 * chargeable (`chargeable[h]`, all hours when omitted).
 */
export function monthlyMaxDemandKva(sub: SubHourlyLoad, powerFactor: number, chargeable?: readonly boolean[]): number[] {
  if (!(powerFactor > 0 && powerFactor <= 1)) throw new Error(`power factor must be in (0, 1], got ${powerFactor}`)
  const k = perHour(sub)
  const md = new Array<number>(12).fill(0)
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    if (chargeable && !chargeable[h]) continue
    const m = monthOfHour(h) - 1
    for (let j = 0; j < k; j++) md[m] = Math.max(md[m]!, sub.kw[h * k + j]!)
  }
  return md.map((kw) => kw / powerFactor)
}
