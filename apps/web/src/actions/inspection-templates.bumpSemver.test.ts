import { describe, it, expect } from 'vitest'
import { bumpSemver } from '../lib/inspections/bump-semver'

describe('bumpSemver', () => {
  it('increments minor: 1.0 → 1.1', () => {
    expect(bumpSemver('1.0')).toBe('1.1')
  })

  it('increments minor in the middle: 1.5 → 1.6', () => {
    expect(bumpSemver('1.5')).toBe('1.6')
  })

  it('rolls minor at 9: 1.9 → 2.0', () => {
    expect(bumpSemver('1.9')).toBe('2.0')
  })

  it('rolls minor at 9 with higher major: 2.9 → 3.0', () => {
    expect(bumpSemver('2.9')).toBe('3.0')
  })

  it('throws on single-part input "1"', () => {
    expect(() => bumpSemver('1')).toThrow()
  })

  it('throws on three-part input "1.0.0"', () => {
    expect(() => bumpSemver('1.0.0')).toThrow()
  })

  it('throws on non-numeric input "abc"', () => {
    expect(() => bumpSemver('abc')).toThrow()
  })
})
