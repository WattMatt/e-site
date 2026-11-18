import { describe, expect, it } from 'vitest'
import { ISSUE_SEVERITY } from './index'
import { dayNumber } from '../solar/schedule/dates'

describe('programme engine types', () => {
  it('classifies issue severities', () => {
    expect(ISSUE_SEVERITY.cycle).toBe('error')
    expect(ISSUE_SEVERITY.negative_float).toBe('warning')
    expect(Object.keys(ISSUE_SEVERITY).length).toBe(18)
  })
  it('keeps the solar date shim working', () => {
    expect(dayNumber('2026-03-02')).toBe(20514)
  })
})
