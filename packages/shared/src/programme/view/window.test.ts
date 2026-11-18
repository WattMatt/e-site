import { describe, expect, it } from 'vitest'
import { visibleRange } from './window'

describe('visibleRange (last is exclusive)', () => {
  it('top: starts at 0 and adds overscan below', () => {
    expect(visibleRange(0, 280, 1000, 28)).toEqual({ first: 0, last: 20 })
  })
  it('middle: overscan both sides', () => {
    expect(visibleRange(2800, 280, 1000, 28)).toEqual({ first: 90, last: 120 })
  })
  it('bottom: clamped to the row count', () => {
    expect(visibleRange(27720, 280, 1000, 28)).toEqual({ first: 980, last: 1000 })
    expect(visibleRange(999999, 280, 1000, 28).last).toBe(1000)
  })
  it('empty', () => {
    expect(visibleRange(0, 280, 0, 28)).toEqual({ first: 0, last: 0 })
  })
  it('fewer rows than the viewport', () => {
    expect(visibleRange(0, 280, 3, 28)).toEqual({ first: 0, last: 3 })
  })
  it('custom overscan and negative scroll', () => {
    expect(visibleRange(-50, 56, 100, 28, 0)).toEqual({ first: 0, last: 2 })
  })
})
