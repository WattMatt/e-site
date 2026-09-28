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
 * The series is aligned to `referenceYear`'s weekdays and holidays; pass the SAME year to
 * `tariffBillCalculator` so TOU periods fall on the days the load was built for.
 */
import { HOURS_PER_YEAR } from './calendar'
import { LoadModelError } from './site-series'

function firstHours(hours: number[]): string {
  return hours.slice(0, 5).join(', ') + (hours.length > 5 ? `, … (${hours.length} in all)` : '')
}

export function caseLoadFromSiteSeries(series: ArrayLike<number>): Float64Array {
  if (series.length !== HOURS_PER_YEAR) {
    throw new LoadModelError('site_series_length', `A site series must have ${HOURS_PER_YEAR} hourly values, got ${series.length}.`)
  }
  const missing: number[] = []
  const negative: number[] = []
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const v = series[h]!
    if (!Number.isFinite(v)) missing.push(h)
    else if (v < 0) negative.push(h)
  }
  if (missing.length > 0) {
    throw new LoadModelError('site_series_unfilled', `The site series has hours with no load value (hour index ${firstHours(missing)}); fill or synthesise them before simulating.`)
  }
  if (negative.length > 0) {
    throw new LoadModelError('site_series_negative', `The site series has negative load (hour index ${firstHours(negative)}); add existing generation back to a bulk meter before simulating.`)
  }
  return Float64Array.from(series)
}
