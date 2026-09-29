import { describe, expect, it } from 'vitest'
import { solarPosition } from './spa'

describe('solarPosition (NREL SPA)', () => {
  it('reproduces the Reda & Andreas (2004) worked example to 1e-4°', () => {
    // 17 Oct 2003 12:30:30 local (UTC−7), Golden CO; NREL/TP-560-34302 Table A5.1:
    // topocentric zenith 50.11162°, azimuth 194.34024°.
    const p = solarPosition(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786, {
      elevationM: 1830.14,
      pressureHpa: 820,
      temperatureC: 11,
      deltaT: 67,
      atmosRefract: 0.5667,
    })
    expect(p.zenith).toBeCloseTo(50.11162, 4)
    expect(p.azimuth).toBeCloseTo(194.34024, 4)
    expect(p.elevation).toBeCloseTo(90 - 50.11162, 4)
  })

  it('azimuth is clockwise from north: morning east, afternoon west, noon north in Johannesburg', () => {
    const o = { elevationM: 1746, pressureHpa: 830, temperatureC: 20 }
    const morning = solarPosition(Date.UTC(2025, 5, 21, 6), -26.2, 28.05, o) // 08:00 SAST
    const noon = solarPosition(Date.UTC(2025, 5, 21, 10, 8), -26.2, 28.05, o)
    const afternoon = solarPosition(Date.UTC(2025, 5, 21, 14), -26.2, 28.05, o)
    expect(morning.azimuth).toBeGreaterThan(0)
    expect(morning.azimuth).toBeLessThan(90)
    expect(Math.min(noon.azimuth, 360 - noon.azimuth)).toBeLessThan(2)
    expect(afternoon.azimuth).toBeGreaterThan(270)
  })

  it('winter-solstice noon elevation in Johannesburg is 90 − 26.2 − 23.44 ≈ 40.4°', () => {
    let best = -90
    for (let m = 0; m < 240; m++) {
      const p = solarPosition(Date.UTC(2025, 5, 21, 8) + m * 60_000, -26.2, 28.05, { elevationM: 1746, pressureHpa: 830, temperatureC: 15 })
      best = Math.max(best, p.elevation)
    }
    expect(best).toBeGreaterThan(40.3)
    expect(best).toBeLessThan(40.5)
  })
})
