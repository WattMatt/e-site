// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderLayoutSheetPdf, niceScaleBar, A3_LANDSCAPE } from './layout-sheet-pdf'
import { JPEG_1PX } from '@/test/fixtures/jpeg-1px'

describe('niceScaleBar', () => {
  it('picks the longest round length that fits', () => {
    expect(niceScaleBar(0.1, 150)).toEqual({ metres: 10, widthPt: 100 })
    expect(niceScaleBar(0.01, 150)).toEqual({ metres: 1, widthPt: 100 })
    expect(niceScaleBar(1, 150)).toEqual({ metres: 100, widthPt: 100 })
  })
})

describe('renderLayoutSheetPdf', () => {
  it('one A3 landscape page with the image, and never throws on non-WinAnsi text', async () => {
    const bytes = await renderLayoutSheetPdf({
      jpegBase64: JPEG_1PX, imageWidthPx: 1, imageHeightPx: 1, metresPerImagePx: 0.02, northBearingDeg: 30,
      projectName: '(P1) Ωmega ≤ → Mall', layoutName: 'Option A', sourceLabel: 'Roof · page 1', version: 2, dateIso: '2026-09-28',
      summaryLines: ['26.40 kWp DC · 50.0 kW AC', 'Strings: 3 pass · 0 fail'], legend: [{ colour: '#e6194b', label: 'INV-1 MPPT 1 · 20 modules' }],
      attribution: '© Mapbox © OpenStreetMap © Maxar', warnings: ['The scale changed since this layout was drawn.'],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
    expect([Math.round(w), Math.round(h)]).toEqual([Math.round(A3_LANDSCAPE[0]), Math.round(A3_LANDSCAPE[1])])
  })
})
