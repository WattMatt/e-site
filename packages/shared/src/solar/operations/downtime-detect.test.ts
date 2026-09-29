import { describe, it, expect } from 'vitest'
import { detectDowntimeCandidates, isDaylight, plantSeries, zeroThresholdKw, type SeriesPoint } from './downtime-detect'

describe('plantSeries: one point per end time on the coarsest interval (review B1)', () => {
  const t = (hhmm: string) => Date.parse(`2026-03-10T${hhmm}:00+02:00`)
  it('is the identity when every point has the same interval', () => {
    const pts = [{ endMs: t('08:30'), kw: 5, intervalMin: 30 }, { endMs: t('09:00'), kw: 7, intervalMin: 30 }]
    expect(plantSeries(pts)).toEqual(pts)
  })
  // Per interval group, kW = energy / the time that group actually covers in the slot, so a missing
  // reading is a gap, never a zero (WM G14); groups are then summed.
  it('folds a 15-minute meter into the 30-minute grid of another, energy-weighted', () => {
    const pts = [
      { endMs: t('08:30'), kw: 10, intervalMin: 30 },
      { endMs: t('08:15'), kw: 4, intervalMin: 15 },
      { endMs: t('08:30'), kw: 6, intervalMin: 15 },
      { endMs: t('08:45'), kw: 2, intervalMin: 15 },
    ]
    expect(plantSeries(pts)).toEqual([
      { endMs: t('08:30'), kw: 15, intervalMin: 30 },
      { endMs: t('09:00'), kw: 2, intervalMin: 30 },
    ])
  })
})

const PTA = { latitude: -25.75, longitude: 28.19, elevationM: 1339 }
const at = (iso: string) => Date.parse(iso)
/** One clear day, 30-min points: 40 kW for interval ends 06:30 to 18:30 (all of March daylight in Pretoria), except zeros where asked. */
function day(date: string, zerosAt: string[] = [], missing: string[] = []): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let k = 1; k <= 48; k++) {
    const end = at(`${date}T00:00:00+02:00`) + k * 30 * 60_000
    const hhmm = new Date(end + 2 * 3_600_000).toISOString().slice(11, 16)
    if (missing.includes(hhmm)) continue
    const producing = hhmm >= '06:30' && hhmm <= '18:30'
    out.push({ endMs: end, kw: producing && !zerosAt.includes(hhmm) ? 40 : 0, intervalMin: 30 })
  }
  return out
}

describe('daylight = SPA elevation > 5° at the interval midpoint (not a fixed 06:00–17:30 window, WM G14)', () => {
  it('06:30 SAST is dark at the June solstice and light at the December solstice in Pretoria', () => {
    expect(isDaylight(at('2026-06-21T06:30:00+02:00'), PTA)).toBe(false)
    expect(isDaylight(at('2026-12-21T06:30:00+02:00'), PTA)).toBe(true)
    expect(isDaylight(at('2026-06-21T12:00:00+02:00'), PTA)).toBe(true)
    expect(isDaylight(at('2026-06-21T17:45:00+02:00'), PTA)).toBe(false)
  })
  it('the zero threshold is 0.5 % of AC kW, never below 10 W', () => {
    expect(zeroThresholdKw(80)).toBeCloseTo(0.4, 9)
    expect(zeroThresholdKw(1)).toBe(0.01)
  })
})

describe('detectDowntimeCandidates', () => {
  it('proposes consecutive zero daylight intervals as one window', () => {
    const c = detectDowntimeCandidates(day('2026-03-10', ['12:00', '12:30', '13:00']), PTA, 80, [])
    expect(c).toEqual([{ startsAt: '2026-03-10T09:30:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', intervals: 3, hours: 1.5 }])
  })
  it('ignores night zeros and a single isolated zero', () => {
    expect(detectDowntimeCandidates(day('2026-03-10', ['10:00']), PTA, 80, [])).toEqual([])
  })
  it('never treats missing data as downtime: a gap splits a run', () => {
    const c = detectDowntimeCandidates(day('2026-03-10', ['12:00', '13:00'], ['12:30']), PTA, 80, [])
    expect(c).toEqual([])
  })
  it('does not re-propose a window already recorded', () => {
    const rec = [{ startMs: at('2026-03-10T11:45:00+02:00'), endMs: at('2026-03-10T12:15:00+02:00') }]
    expect(detectDowntimeCandidates(day('2026-03-10', ['12:00', '12:30', '13:00']), PTA, 80, rec)).toEqual([])
  })
  it('does not flag a winter 06:30 zero that WM’s fixed window would have', () => {
    const pts: SeriesPoint[] = [
      { endMs: at('2026-06-21T06:30:00+02:00'), kw: 0, intervalMin: 30 },
      { endMs: at('2026-06-21T07:00:00+02:00'), kw: 0, intervalMin: 30 },
    ]
    expect(detectDowntimeCandidates(pts, PTA, 80, [])).toEqual([])
  })
})
