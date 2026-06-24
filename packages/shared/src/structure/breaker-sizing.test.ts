import { describe, it, expect } from 'vitest'
import {
  STANDARD_BREAKER_SERIES,
  nextStandardBreaker,
  poleConfigFromCores,
  deriveIncomerBreaker,
} from './breaker-sizing'

describe('nextStandardBreaker', () => {
  it('rounds up to the next standard size', () => {
    expect(nextStandardBreaker(60)).toBe(63)
    expect(nextStandardBreaker(64)).toBe(80)
    expect(nextStandardBreaker(5)).toBe(6)
  })
  it('returns the exact size when on a boundary', () => {
    expect(nextStandardBreaker(63)).toBe(63)
    expect(nextStandardBreaker(6)).toBe(6)
    expect(nextStandardBreaker(1600)).toBe(1600)
  })
  it('returns null for over-range, null, zero, or negative', () => {
    expect(nextStandardBreaker(1601)).toBeNull()
    expect(nextStandardBreaker(null)).toBeNull()
    expect(nextStandardBreaker(0)).toBeNull()
    expect(nextStandardBreaker(-5)).toBeNull()
  })
  it('exposes the full series', () => {
    expect(STANDARD_BREAKER_SERIES[0]).toBe(6)
    expect(STANDARD_BREAKER_SERIES[STANDARD_BREAKER_SERIES.length - 1]).toBe(1600)
  })
})

describe('poleConfigFromCores', () => {
  it('maps three-phase cores to TP', () => {
    expect(poleConfigFromCores('3')).toBe('TP')
    expect(poleConfigFromCores('3+E')).toBe('TP')
    expect(poleConfigFromCores('4')).toBe('TP')
  })
  it('maps other cores to SP and null to null', () => {
    expect(poleConfigFromCores('2')).toBe('SP')
    expect(poleConfigFromCores(null)).toBeNull()
  })
})

describe('deriveIncomerBreaker', () => {
  it('derives breaker + poles from load and cores', () => {
    expect(deriveIncomerBreaker({ designLoadA: 60, cores: '3', capacityA: 170 })).toEqual({
      breakerA: 63,
      poleConfig: 'TP',
      underProtected: false,
    })
  })
  it('flags under-protected when the breaker exceeds cable capacity', () => {
    expect(deriveIncomerBreaker({ designLoadA: 60, cores: '3', capacityA: 50 })).toEqual({
      breakerA: 63,
      poleConfig: 'TP',
      underProtected: true,
    })
  })
  it('cannot assess under-protection when capacity is unknown', () => {
    const r = deriveIncomerBreaker({ designLoadA: 60, cores: '3', capacityA: null })
    expect(r.breakerA).toBe(63)
    expect(r.underProtected).toBe(false)
  })
  it('returns null breaker when load is missing', () => {
    expect(deriveIncomerBreaker({ designLoadA: null, cores: '3', capacityA: 170 })).toEqual({
      breakerA: null,
      poleConfig: 'TP',
      underProtected: false,
    })
  })
})
