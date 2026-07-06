export interface GeneratorSizingData {
  rating: string
  load25: number
  load50: number
  load75: number
  load100: number
}

export const GENERATOR_SIZING_TABLE: GeneratorSizingData[] = [
  { rating: '10 kVA', load25: 1, load50: 1, load75: 2, load100: 3 },
  { rating: '12 kVA', load25: 1, load50: 2, load75: 3, load100: 4 },
  { rating: '15 kVA', load25: 1, load50: 2, load75: 3, load100: 4 },
  { rating: '20 kVA', load25: 1, load50: 3, load75: 4, load100: 5 },
  { rating: '25 kVA', load25: 2, load50: 3, load75: 5, load100: 6 },
  { rating: '30 kVA', load25: 2, load50: 4, load75: 5, load100: 7 },
  { rating: '40 kVA', load25: 3, load50: 5, load75: 8, load100: 10 },
  { rating: '50 kVA', load25: 3, load50: 6, load75: 9, load100: 12 },
  { rating: '60 kVA', load25: 3.5, load50: 7, load75: 8.93, load100: 13.7 },
  { rating: '80 kVA', load25: 4.8, load50: 9.6, load75: 13.48, load100: 19.4 },
  { rating: '100 kVA', load25: 5.5, load50: 11, load75: 14.18, load100: 22 },
  { rating: '120 kVA', load25: 7.9, load50: 15.8, load75: 21.09, load100: 29.3 },
  { rating: '150 kVA', load25: 9, load50: 18, load75: 25.73, load100: 36.6 },
  { rating: '200 kVA', load25: 7.5, load50: 15, load75: 29.75, load100: 42 },
  { rating: '250 kVA', load25: 13.1, load50: 26.2, load75: 36.05, load100: 51.5 },
  { rating: '300 kVA', load25: 16.4, load50: 32.8, load75: 45.85, load100: 64.1 },
  { rating: '350 kVA', load25: 19.4, load50: 38.8, load75: 50.14, load100: 70 },
  { rating: '400 kVA', load25: 21.4, load50: 42.8, load75: 61.60, load100: 85.8 },
  { rating: '450 kVA', load25: 25.9, load50: 51.8, load75: 63.44, load100: 89.9 },
  { rating: '500 kVA', load25: 25.6, load50: 51.2, load75: 70.18, load100: 100.6 },
  { rating: '600 kVA', load25: 30.6, load50: 61.2, load75: 79.10, load100: 110.8 },
  { rating: '750 kVA', load25: 39.7, load50: 79.4, load75: 97.30, load100: 146.7 },
  { rating: '800 kVA', load25: 46.7, load50: 93.4, load75: 113.84, load100: 170.6 },
  { rating: '1000 kVA', load25: 62.1, load50: 124.2, load75: 152.16, load100: 225.2 },
]

/**
 * Resolve a sizing-table row from whatever the zone editor stored. Exact label
 * match first ("400 kVA"), then numeric-kVA match — prod data holds bare "400"
 * / "350", and the old exact-only lookup silently zeroed the whole operational
 * tariff for them (PNP FAERIE GLEN, 2026-07-06).
 */
function findSizingRow(size: string): GeneratorSizingData | undefined {
  const exact = GENERATOR_SIZING_TABLE.find((r) => r.rating === size)
  if (exact) return exact
  const kva = parseInt(size, 10)
  if (Number.isNaN(kva)) return undefined
  return GENERATOR_SIZING_TABLE.find((r) => parseInt(r.rating, 10) === kva)
}

/** True when a stored generator size resolves to a sizing-table row (readiness check). */
export function hasFuelRating(size: string | null | undefined): boolean {
  return size != null && size !== '' && findSizingRow(size) !== undefined
}

// Fuel consumption (l/h) for (generator size, running-load %).
// Transcribed VERBATIM from nexus generatorReportPdfBuilder.ts getFuelConsumption
// (the billed-report path). Piecewise-linear over the 25/50/75/100 table columns using
// `<=` boundaries; below 25% returns load25; above 100% extrapolates off the 75→100 slope.
// Unknown size returns 0 (nexus returns 0 — it does NOT throw).
export function getFuelConsumption(size: string, runningLoadPercent: number): number {
  const row = findSizingRow(size)
  if (!row) return 0
  if (runningLoadPercent <= 25) return row.load25
  if (runningLoadPercent <= 50) {
    const r = (runningLoadPercent - 25) / 25
    return row.load25 + r * (row.load50 - row.load25)
  }
  if (runningLoadPercent <= 75) {
    const r = (runningLoadPercent - 50) / 25
    return row.load50 + r * (row.load75 - row.load50)
  }
  const r = (runningLoadPercent - 75) / 25
  return row.load75 + r * (row.load100 - row.load75)
}
