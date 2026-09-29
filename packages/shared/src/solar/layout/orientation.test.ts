import { describe, it, expect } from 'vitest'
import { mod360, sheetDirection, sheetBearing, trueAzimuth, sheetBearingForAzimuth, equatorFacingAzimuth, arrayAzimuth } from './orientation'
import { GENERIC_MODULE_550, type ArrayProps } from './types'

describe('sheet bearings (° clockwise from sheet-up, image y down)', () => {
  it('mod360 wraps negatives and 360', () => {
    expect(mod360(-90)).toBe(270)
    expect(mod360(360)).toBe(0)
    expect(mod360(725)).toBe(5)
  })
  it('sheetDirection points up for 0 and right for 90', () => {
    const up = sheetDirection(0)
    expect(up.x).toBeCloseTo(0, 12); expect(up.y).toBeCloseTo(-1, 12)
    const right = sheetDirection(90)
    expect(right.x).toBeCloseTo(1, 12); expect(right.y).toBeCloseTo(0, 12)
  })
  it('sheetBearing of a drawn vector', () => {
    const o = { x: 0, y: 0 }
    expect(sheetBearing(o, { x: 0, y: -1 })).toBeCloseTo(0, 9)
    expect(sheetBearing(o, { x: 1, y: 0 })).toBeCloseTo(90, 9)
    expect(sheetBearing(o, { x: 0, y: 1 })).toBeCloseTo(180, 9)
    expect(sheetBearing(o, { x: -1, y: 0 })).toBeCloseTo(270, 9)
  })
})

describe('true azimuth (0 = N, 90 = E, clockwise)', () => {
  it('north up: sheet-down faces south', () => {
    expect(trueAzimuth(180, 0)).toBe(180)
  })
  it('north pointing sheet-right: sheet-up faces west', () => {
    expect(trueAzimuth(0, 90)).toBe(270)
  })
  it('inverts', () => {
    for (const [az, n] of [[0, 0], [180, 37], [90, 300], [271.5, 12.25]] as const) {
      expect(trueAzimuth(sheetBearingForAzimuth(az, n), n)).toBeCloseTo(az, 9)
    }
  })
  it('equator-facing default: north in the southern hemisphere', () => {
    expect(equatorFacingAzimuth(-26.2)).toBe(0)
    expect(equatorFacingAzimuth(40)).toBe(180)
  })
})

describe('arrayAzimuth', () => {
  const props: ArrayProps = {
    roofId: 'r', module: GENERIC_MODULE_550, orientation: 'portrait', mounting: 'flush', tiltDeg: 30,
    facingSheetDeg: 30, azimuthOverrideDeg: null, rowPitchM: 2, gapM: 0.02,
  }
  it('is null until north is set', () => {
    expect(arrayAzimuth(props, null)).toBeNull()
  })
  it('derives from the facing bearing and north', () => {
    expect(arrayAzimuth(props, 30)).toBe(0)
  })
  it('an override wins even without north', () => {
    expect(arrayAzimuth({ ...props, azimuthOverrideDeg: 15 }, null)).toBe(15)
  })
})
