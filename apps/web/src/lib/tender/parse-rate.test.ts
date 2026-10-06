import { describe, it, expect } from 'vitest'
import { parseRate } from './parse-rate'

describe('parseRate (a rate as a South African bidder types it)', () => {
  it('reads a decimal comma as cents, not as a thousands separator', () => {
    expect(parseRate('12,50')).toEqual({ ok: true, value: 12.5 })
    expect(parseRate('1 000,50')).toEqual({ ok: true, value: 1000.5 })
    expect(parseRate('0,5')).toEqual({ ok: true, value: 0.5 })
  })

  it('reads a decimal point, spaces and commas as thousands separators', () => {
    expect(parseRate('12.50')).toEqual({ ok: true, value: 12.5 })
    expect(parseRate('1 000.50')).toEqual({ ok: true, value: 1000.5 })
    expect(parseRate('1,000.50')).toEqual({ ok: true, value: 1000.5 })
    expect(parseRate('1.000,50')).toEqual({ ok: true, value: 1000.5 })
    expect(parseRate('1,234,567')).toEqual({ ok: true, value: 1234567 })
    expect(parseRate('R 450')).toEqual({ ok: true, value: 450 })
    expect(parseRate(' 7 ')).toEqual({ ok: true, value: 7 })
  })

  it('reads a lone point as a decimal (a point never groups thousands in en-ZA), and a stored rate round-trips', () => {
    expect(parseRate('12.345')).toEqual({ ok: true, value: 12.345 })
    expect(parseRate('1.000')).toEqual({ ok: true, value: 1 })
    expect(parseRate(String(0.1255))).toEqual({ ok: true, value: 0.1255 })
    expect(parseRate('1.000.000')).toEqual({ ok: true, value: 1000000 })
  })

  it('reads a leading zero or a leading separator as a decimal', () => {
    expect(parseRate('0,125')).toEqual({ ok: true, value: 0.125 })
    expect(parseRate('.5')).toEqual({ ok: true, value: 0.5 })
    expect(parseRate(',5')).toEqual({ ok: true, value: 0.5 })
  })

  it('refuses a lone comma before three digits, which could mean two different prices', () => {
    expect(parseRate('1,000').ok).toBe(false) // R1 000 or R1,000?
    expect(parseRate('12,345').ok).toBe(false)
  })

  it('treats blank as no rate and refuses junk and negatives', () => {
    expect(parseRate('')).toEqual({ ok: true, value: null })
    expect(parseRate('  ')).toEqual({ ok: true, value: null })
    for (const v of ['abc', '-5', '1,2,3', '12..5', '1e5', '1.2.3']) expect(parseRate(v).ok).toBe(false)
  })
})
