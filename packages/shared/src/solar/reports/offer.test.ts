import { describe, it, expect } from 'vitest'
import { offerBaseZar, offerPrice } from './offer'

describe('offerPrice (§9.3: capex + margin %)', () => {
  it('adds the margin, then VAT on the offer, to the cent', () => {
    expect(offerPrice(1_000_000, 15)).toEqual({
      capexExclVatZar: 1_000_000, marginPct: 15, marginZar: 150_000,
      offerExclVatZar: 1_150_000, vatZar: 172_500, offerInclVatZar: 1_322_500,
    })
  })
  it('rounds to cents', () => {
    const o = offerPrice(333.333, 10)
    expect(o.marginZar).toBe(33.33)
    expect(o.capexExclVatZar).toBe(333.33)
    expect(o.offerExclVatZar).toBe(366.66) // the sum of the two rounded parts, so the lines add up on paper
  })
  it('refuses a non-positive capex or an out-of-range margin', () => {
    expect(() => offerPrice(0, 10)).toThrow('capex')
    expect(() => offerPrice(100, -1)).toThrow('margin')
    expect(() => offerPrice(100, 101)).toThrow('margin')
  })
  it('excludes capex lines already categorised as margin (no double margin)', () => {
    expect(offerBaseZar({ exclVatZar: 1_100_000, byCategory: { modules: 1_000_000, margin: 100_000 } })).toBe(1_000_000)
    expect(offerBaseZar({ exclVatZar: 500, byCategory: {} })).toBe(500)
  })
})
