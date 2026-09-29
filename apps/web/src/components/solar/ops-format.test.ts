import { describe, it, expect } from 'vitest'
import { kwh, pctSigned, sastDateTime } from './ops-format'

describe('ops-format (locale-free, same bytes on server and browser)', () => {
  it('groups thousands with a space and signs percentages', () => {
    expect(kwh(12345.6)).toBe('12 346')
    expect(kwh(null)).toBe('—')
    expect(pctSigned(-10)).toBe('-10.0 %')
    expect(pctSigned(2.345)).toBe('+2.3 %')
    expect(pctSigned(null)).toBe('—')
  })
  it('prints an instant in SAST', () => {
    expect(sastDateTime('2026-03-10T08:00:00.000Z')).toBe('2026-03-10 10:00')
  })
})
