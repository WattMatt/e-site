import { describe, it, expect } from 'vitest'
import { isPdfPath, isImagePath, withPdfSource } from '../lib/pdf-raster'
import type { AnnotationData } from '../components/attachments/types'

describe('isPdfPath / isImagePath', () => {
  it('detects PDFs (case-insensitive)', () => {
    expect(isPdfPath('plans/level-1.pdf')).toBe(true)
    expect(isPdfPath('plans/LEVEL-1.PDF')).toBe(true)
    expect(isPdfPath('plans/level-1.png')).toBe(false)
  })

  it('detects annotator-loadable images', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'heic', 'svg']) {
      expect(isImagePath(`plan.${ext}`)).toBe(true)
    }
    expect(isImagePath('plan.pdf')).toBe(false)
  })
})

describe('withPdfSource', () => {
  const base: AnnotationData = {
    version: 1,
    canvas: { width: 100, height: 80 },
    baseImage: { naturalWidth: 200, naturalHeight: 160, signedUrl: 'file:///tmp/page.png' },
    shapes: [],
  }

  it('stamps the source page and drops the transient rasterised image', () => {
    const out = withPdfSource(base, 3)
    expect(out.sourcePageIndex).toBe(3)
    expect(out.baseImage.signedUrl).toBeUndefined()
    expect(out.baseImage.naturalWidth).toBe(200) // natural dims preserved
    expect(out.shapes).toBe(base.shapes)          // shapes preserved
  })

  it('does not mutate the input', () => {
    withPdfSource(base, 1)
    expect(base.sourcePageIndex).toBeUndefined()
    expect(base.baseImage.signedUrl).toBe('file:///tmp/page.png')
  })
})
