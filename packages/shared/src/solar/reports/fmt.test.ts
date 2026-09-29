import { describe, it, expect } from 'vitest'
import { fixed, zar, zarCents, pct, mwh, kwp, kw, years, isoDate } from './fmt'

describe('fmt (locale-free, identical on server, browser and PDF)', () => {
  it('groups thousands with a plain space and never uses a locale', () => {
    expect(fixed(1234567.891, 2)).toBe('1 234 567.89')
    expect(fixed(999, 0)).toBe('999')
    expect(fixed(-0.001, 1)).toBe('0.0')
    expect(fixed(Number.NaN, 1)).toBe('n/a')
  })
  it('formats rand, percent, energy, power and years with units', () => {
    expect(zar(1_000_000)).toBe('R 1 000 000')
    expect(zar(-1500.4)).toBe('-R 1 500')
    expect(zarCents(1150000)).toBe('R 1 150 000.00')
    expect(pct(0.2105)).toBe('21.1 %')
    expect(pct(null)).toBe('n/a')
    expect(mwh(845_000)).toBe('845.0 MWh')
    expect(kwp(500)).toBe('500.0 kWp')
    expect(kw(400)).toBe('400.0 kW')
    expect(years(4.63)).toBe('4.6 years')
    expect(years(null)).toBe('n/a')
    expect(isoDate('2026-10-28T09:00:00.000Z')).toBe('2026-10-28')
  })
  it('emits only printable ASCII (safe for every PDF standard font)', () => {
    for (const s of [zar(-12345.6), pct(0.5), mwh(1), years(2), fixed(1e9, 2)]) expect(s).toMatch(/^[\x20-\x7e]+$/)
  })
})
