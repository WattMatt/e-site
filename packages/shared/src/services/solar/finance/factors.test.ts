import { describe, expect, it } from 'vitest'
import { batteryHealth, cpiFactor, DEFAULT_ESCALATION, degradationFactor, escalationRate, tariffFactors } from './factors'

describe('degradation (spec §3.6) — applied once, in the cashflow', () => {
  it('year n = (1 − d₁)(1 − d)^(n−1)', () => {
    expect(degradationFactor(1, 0.02, 0.005)).toBeCloseTo(0.98, 15)
    expect(degradationFactor(2, 0.02, 0.005)).toBeCloseTo(0.98 * 0.995, 15)
    expect(degradationFactor(25, 0.02, 0.005)).toBeCloseTo(0.98 * 0.995 ** 24, 15)
  })
})

describe('tariff escalation path (D-07)', () => {
  it('9 % into year 2, linear to 7 % at year 10, then CPI + 1 %', () => {
    expect(escalationRate(1, DEFAULT_ESCALATION, 0.05)).toBe(0)
    expect(escalationRate(2, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.09, 15)
    expect(escalationRate(6, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.08, 15)
    expect(escalationRate(10, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.07, 15)
    expect(escalationRate(11, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.06, 15)
  })

  it('published approved increases override the default path for their years', () => {
    const p = { ...DEFAULT_ESCALATION, published: [0.1277, 0.0536] }
    expect(escalationRate(2, p, 0.05)).toBe(0.1277)
    expect(escalationRate(3, p, 0.05)).toBe(0.0536)
    expect(escalationRate(4, p, 0.05)).toBeCloseTo(0.085, 15)
    expect(tariffFactors(3, p, 0.05)).toEqual([1, 1.1277, 1.1277 * 1.0536])
  })

  it('CPI factor is 1 in year 1', () => {
    expect(cpiFactor(1, 0.05)).toBe(1)
    expect(cpiFactor(3, 0.05)).toBeCloseTo(1.1025, 15)
  })
})

describe('battery capacity fade', () => {
  it('fades 2 %/yr, floors at 70 %, and is renewed after the replacement year', () => {
    expect(batteryHealth(1, 0.02, 0.7, 10)).toBe(1)
    expect(batteryHealth(10, 0.02, 0.7, 10)).toBeCloseTo(0.82, 15)
    expect(batteryHealth(11, 0.02, 0.7, 10)).toBe(1)
    expect(batteryHealth(20, 0.02, 0.7, null)).toBe(0.7)
  })
})
