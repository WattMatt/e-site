import { describe, expect, it } from 'vitest'
import { DAYS_IN_MONTH } from '../time'
import type { PvgisTmy, PvgisTmyRow } from './pvgis-tmy'
import { temperatureExtremes, tmyToReferenceYear } from './reference-year'

/** One row per non-leap UTC hour; ghi carries the UTC hour-of-year index so shifts are visible. */
function syntheticTmy(): PvgisTmy {
  const rows: PvgisTmyRow[] = []
  let u = 0
  for (let m = 1; m <= 12; m++) {
    const sourceYear = 2005 + m // months from different years, as in a real TMY
    for (let d = 1; d <= DAYS_IN_MONTH[m - 1]!; d++) {
      for (let h = 0; h < 24; h++) {
        rows.push({ sourceYear, month: m, day: d, hourUtc: h, t2m: u % 40, ghi: u, dni: 0, dhi: 0, ws10m: 1, sp: 100000 })
        u++
      }
    }
  }
  return { latitude: -26.2, longitude: 28.05, elevation: 1746, irradianceTimeOffsetH: 0.05, radiationDb: 'PVGIS-SARAH2', rows }
}

describe('tmyToReferenceYear', () => {
  it('shifts UTC → SAST by +2 h, wrapping the last two UTC hours to 1 Jan 00:00–02:00 SAST', () => {
    const w = tmyToReferenceYear(syntheticTmy())
    expect(w.ghi.length).toBe(8760)
    expect(w.ghi[0]).toBe(8758) // 31 Dec 22:00 UTC
    expect(w.ghi[1]).toBe(8759) // 31 Dec 23:00 UTC
    expect(w.ghi[2]).toBe(0) //    1 Jan 00:00 UTC = 02:00 SAST
    expect(w.ghi[14]).toBe(12) //  12:00 UTC = 14:00 SAST
  })

  it('orders by calendar position, not by source year', () => {
    const t = syntheticTmy()
    t.rows.reverse()
    expect(Array.from(tmyToReferenceYear(t).ghi.slice(0, 5))).toEqual([8758, 8759, 0, 1, 2])
  })

  it('drops 29 February rows from a leap-year source month', () => {
    const t = syntheticTmy()
    for (let h = 0; h < 24; h++) t.rows.push({ ...t.rows[0]!, sourceYear: 2020, month: 2, day: 29, hourUtc: h, ghi: -1 })
    const w = tmyToReferenceYear(t)
    expect(Math.min(...w.ghi)).toBe(0)
  })

  it('refuses a duplicated or a missing hour', () => {
    const dup = syntheticTmy()
    dup.rows.push({ ...dup.rows[100]! })
    expect(() => tmyToReferenceYear(dup)).toThrow(/duplicate TMY hour/)
    const gap = syntheticTmy()
    gap.rows.splice(5000, 1)
    expect(() => tmyToReferenceYear(gap)).toThrow(/missing UTC hour index 5000/)
  })

  it('converts pressure Pa → hPa, carries the sample offset and names the source', () => {
    const w = tmyToReferenceYear(syntheticTmy())
    expect(w.pressure[0]).toBe(1000)
    expect(w.sampleOffsetH).toBe(0.05)
    expect(w.source).toBe('PVGIS-SARAH2 PVGIS TMY')
  })

  it('reports the ambient temperature extremes for string sizing', () => {
    expect(temperatureExtremes(tmyToReferenceYear(syntheticTmy()))).toEqual({ minC: 0, maxC: 39 })
  })
})
