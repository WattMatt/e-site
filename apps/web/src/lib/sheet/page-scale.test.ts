import { describe, it, expect } from 'vitest'
import { pageScaleFor, withPageScale } from './page-scale'

const sheet = { pixels_per_meter: 20, page_scales: [{ pageIndex: 3, pixelsPerMeter: 41.25 }] }

describe('pageScaleFor', () => {
  it('a page with its own scale uses it', () => {
    expect(pageScaleFor(sheet, 3)).toBe(41.25)
  })
  it('page 1 falls back to the drawing scale', () => {
    expect(pageScaleFor(sheet, 1)).toBe(20)
  })
  it('page 2+ without its own scale is unscaled', () => {
    expect(pageScaleFor(sheet, 2)).toBeNull()
  })
  it('a page-1 entry beats the drawing scale', () => {
    expect(pageScaleFor({ pixels_per_meter: 20, page_scales: [{ pageIndex: 1, pixelsPerMeter: 22 }] }, 1)).toBe(22)
  })
})

describe('withPageScale', () => {
  it('records a page-2 calibration without touching the drawing scale', () => {
    const next = withPageScale(sheet, 2, 18.5)
    expect(pageScaleFor(next, 2)).toBe(18.5)
    expect(next.pixels_per_meter).toBe(20)
    expect(sheet.page_scales).toHaveLength(1) // not mutated
  })
  it('a page-1 calibration wins over any stale page-1 entry', () => {
    const stale = { pixels_per_meter: 20, page_scales: [{ pageIndex: 1, pixelsPerMeter: 22 }] }
    const next = withPageScale(stale, 1, 25)
    expect(pageScaleFor(next, 1)).toBe(25)
    expect(next.pixels_per_meter).toBe(25)
  })
})
