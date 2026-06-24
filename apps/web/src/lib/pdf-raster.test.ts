import { describe, it, expect } from 'vitest'
import { isPdfPath, isImagePath } from './pdf-raster'

describe('floor-plan path classification (the attach-picker filter)', () => {
  it('classifies PDFs as PDF, not image', () => {
    expect(isPdfPath('org/proj/plan.pdf')).toBe(true)
    expect(isPdfPath('PLAN.PDF')).toBe(true)
    expect(isImagePath('org/proj/plan.pdf')).toBe(false)
  })

  it('classifies raster/vector images as image, not PDF', () => {
    for (const p of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.heic', 'a.svg']) {
      expect(isImagePath(p)).toBe(true)
      expect(isPdfPath(p)).toBe(false)
    }
  })

  it('treats unsupported (e.g. DWG) as neither — excluded from the picker', () => {
    expect(isImagePath('a.dwg')).toBe(false)
    expect(isPdfPath('a.dwg')).toBe(false)
  })

  it('a PDF floor plan is now selectable (image OR pdf), fixing the bug', () => {
    const path = 'org/proj/groundfloor.pdf'
    expect(isImagePath(path) || isPdfPath(path)).toBe(true)
  })
})
