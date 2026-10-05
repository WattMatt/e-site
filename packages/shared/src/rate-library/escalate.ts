/**
 * Index escalation: express a past rate in a later month's money.
 *
 *   escalated = nominal × index(to) ÷ index(base)
 *
 * The base month is the calendar month the rate was priced in. "To" defaults
 * to the latest month the series has. Two honest edge cases:
 *   - priced after the latest published index → factor 1, flagged (the index
 *     has not caught up; inflating by a guess would be inventing data);
 *   - priced before the series starts → no factor at all.
 */

/** 'YYYY-MM' → index value. */
export type IndexSeries = Map<string, number>

export type EscalationFlag = 'base_after_latest_index' | 'base_before_series' | 'to_missing' | null

export interface Escalation { value: number | null; factor: number | null; baseMonth: string; toMonth: string; flag: EscalationFlag }

export const monthOf = (isoDate: string) => isoDate.slice(0, 7)

/** Build a series from a { year: [Jan … Dec, annualAverage?] } table. */
export function cpiFromTable(table: Record<string | number, number[]>): IndexSeries {
  const s: IndexSeries = new Map()
  for (const [y, vals] of Object.entries(table)) {
    vals.slice(0, 12).forEach((v, i) => s.set(`${y}-${String(i + 1).padStart(2, '0')}`, v))
  }
  return s
}

export function latestMonth(s: IndexSeries): string | null {
  let m: string | null = null
  for (const k of s.keys()) if (m === null || k > m) m = k
  return m
}

function earliestMonth(s: IndexSeries): string | null {
  let m: string | null = null
  for (const k of s.keys()) if (m === null || k < m) m = k
  return m
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp

export function escalate(nominal: number, pricedOn: string, series: IndexSeries, toMonth?: string): Escalation {
  const baseMonth = monthOf(pricedOn)
  const to = toMonth ?? latestMonth(series) ?? baseMonth
  const first = earliestMonth(series)
  if (first === null || baseMonth < first) return { value: null, factor: null, baseMonth, toMonth: to, flag: 'base_before_series' }
  const toVal = series.get(to)
  if (toVal === undefined) return { value: null, factor: null, baseMonth, toMonth: to, flag: 'to_missing' }
  if (baseMonth > to) return { value: round(nominal, 2), factor: 1, baseMonth, toMonth: to, flag: 'base_after_latest_index' }
  const baseVal = series.get(baseMonth)
  if (baseVal === undefined) return { value: null, factor: null, baseMonth, toMonth: to, flag: 'base_before_series' }
  const f = toVal / baseVal
  return { value: round(nominal * f, 2), factor: round(f, 6), baseMonth, toMonth: to, flag: null }
}
