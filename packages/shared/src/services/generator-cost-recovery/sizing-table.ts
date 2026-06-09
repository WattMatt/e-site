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

const LOAD_POINTS: Array<{ pct: number; key: keyof GeneratorSizingData }> = [
  { pct: 25, key: 'load25' },
  { pct: 50, key: 'load50' },
  { pct: 75, key: 'load75' },
  { pct: 100, key: 'load100' },
]

export function getFuelConsumption(size: string, runningLoadPercent: number): number {
  const row = GENERATOR_SIZING_TABLE.find((r) => r.rating === size)
  if (!row) throw new Error(`Unknown generator size: "${size}"`)

  const clamped = Math.max(25, Math.min(100, runningLoadPercent))

  // find surrounding load points
  let lower = LOAD_POINTS[0]
  let upper = LOAD_POINTS[LOAD_POINTS.length - 1]

  for (let i = 0; i < LOAD_POINTS.length - 1; i++) {
    if (clamped >= LOAD_POINTS[i].pct && clamped <= LOAD_POINTS[i + 1].pct) {
      lower = LOAD_POINTS[i]
      upper = LOAD_POINTS[i + 1]
      break
    }
  }

  if (lower.pct === upper.pct) return row[lower.key] as number

  const t = (clamped - lower.pct) / (upper.pct - lower.pct)
  return (row[lower.key] as number) + t * ((row[upper.key] as number) - (row[lower.key] as number))
}
