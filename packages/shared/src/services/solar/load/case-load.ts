/**
 * Integration glue: a site series from the load model (S1–S4, hourly kW over the reference year)
 * becomes the engine's `CaseInput.load`.
 *
 * The types already line up (`Float64Array` of 8760), so the adapter exists for what the type
 * system cannot see: a site series may carry NaN for hours nothing could fill (gap-fill leaves
 * `unfilledHours`; `monthlyEnergyKwh` skips them), and the energy balance would carry a NaN
 * straight into every bill and the NPV. A negative hour means the series is net of generation
 * (a bulk meter with existing PV not added back — `buildS1`'s `existingPv`), which the balance
 * would read as load. Both are refused here, loudly, with the hours named.
 *
 * The series is aligned to `referenceYear`'s weekdays and holidays, so the year travels WITH the
 * load (`SiteLoadForCase`) and `tariffBillCalculator` takes it from there: a load built for 2025
 * but priced on 2026 day types shifts every weekday and misprices TOU with no error.
 */
import { HOURS_PER_YEAR } from './calendar'
import { LoadModelError } from './site-series'

export interface SiteLoadForCase {
  /** `CaseInput.load`: hourly kW, 8760 values, finite and ≥ 0. */
  load: Float64Array
  /** The year the series' day types were aligned to; pass it as `tariffBillCalculator`'s `referenceYear`. */
  referenceYear: number
}

function firstHours(hours: number[]): string {
  return hours.slice(0, 5).join(', ') + (hours.length > 5 ? `, … (${hours.length} in all)` : '')
}

export function caseLoadFromSiteSeries(input: { series: ArrayLike<number>; referenceYear: number }): SiteLoadForCase {
  const { series, referenceYear } = input
  if (!Number.isInteger(referenceYear) || referenceYear < 1900 || referenceYear > 2200) {
    throw new LoadModelError('invalid_reference_year', `The reference year must be a calendar year, got ${referenceYear}.`)
  }
  if (series.length !== HOURS_PER_YEAR) {
    throw new LoadModelError('site_series_length', `A site series must have ${HOURS_PER_YEAR} hourly values, got ${series.length}.`)
  }
  const missing: number[] = []
  const infinite: number[] = []
  const negative: number[] = []
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const v = series[h]!
    if (Number.isNaN(v)) missing.push(h)
    else if (!Number.isFinite(v)) infinite.push(h)
    else if (v < 0) negative.push(h)
  }
  if (missing.length > 0) {
    throw new LoadModelError('site_series_unfilled', `The site series has hours with no load value (hour index ${firstHours(missing)}); fill or synthesise them before simulating.`)
  }
  if (infinite.length > 0) {
    throw new LoadModelError('site_series_non_finite', `The site series has infinite load (hour index ${firstHours(infinite)}).`)
  }
  if (negative.length > 0) {
    throw new LoadModelError('site_series_negative', `The site series has negative load (hour index ${firstHours(negative)}); add existing generation back to a bulk meter before simulating.`)
  }
  return { load: Float64Array.from(series), referenceYear }
}
