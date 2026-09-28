import { describe, it, expect } from 'vitest'
import { addDays, referenceYearDates } from './calendar'
import { expandArchetype, getArchetype } from './archetypes'
import type { DailyHours } from './hourly'
import { shapeFromSample, synthesiseTenant } from './synthesis'

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('synthesiseTenant', () => {
  const shape = expandArchetype(getArchetype('retail'), 2027)
  const dates = referenceYearDates(2027)
  it('A × D × shape / 1000 kW; zero before beneficial occupation', () => {
    const s = synthesiseTenant({ areaM2: 100, densityWPerM2: 30, shape, boDate: '2027-03-01' }, 2027)
    const march1 = dates.indexOf('2027-03-01')
    expect(s[(march1 - 1) * 24 + 12]).toBe(0)
    expect(s[march1 * 24 + 12]).toBeCloseTo(3 * shape[march1 * 24 + 12], 12)
  })
  it('no BO date: loaded all year', () => {
    const s = synthesiseTenant({ areaM2: 100, densityWPerM2: 30, shape }, 2027)
    expect(s[12]).toBeCloseTo(3 * shape[12], 12)
  })
  it('BO after the reference year: year 1 is empty', () => {
    expect(synthesiseTenant({ areaM2: 100, densityWPerM2: 30, shape, boDate: '2028-02-01' }, 2027).every((v) => v === 0)).toBe(true)
  })
})

describe('shapeFromSample (a meter with < 30 days)', () => {
  const sample: DailyHours = new Map()
  for (let i = 0; i < 7; i++) {
    const d = addDays('2025-03-10', i)   // Mon..Sun
    sample.set(d, new Float64Array(24).fill(i < 5 ? 10 : i === 5 ? 5 : 2))
  }
  const retail = getArchetype('retail')
  const s = shapeFromSample(sample, retail)
  it('uses the sampled day types', () => {
    expect([s.profiles.weekday[12], s.profiles.saturday[12], s.profiles.sunday[12]]).toEqual([10, 5, 2])
  })
  it('borrows a missing day type from the archetype, scaled to the sample', () => {
    const ratio = ((10 + 5 + 2) / 3) / ((mean(retail.profiles.weekday) + mean(retail.profiles.saturday) + mean(retail.profiles.sunday)) / 3)
    expect(s.profiles.holiday[0]).toBeCloseTo(retail.profiles.holiday[0] * ratio, 12)
    expect(s.operating).toBe(retail.operating)
  })
})
