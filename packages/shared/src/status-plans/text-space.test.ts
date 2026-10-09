import { describe, it, expect } from 'vitest'
import { composeMatrix, textItemsToImageSpace, type Matrix } from './text-space'

/** pdf.js 5.7 PageViewport transform (dontFlip false, no offset), copied for the test. */
export function pdfViewportTransform(
  viewBox: [number, number, number, number],
  rotation: 0 | 90 | 180 | 270,
  scale: number,
): Matrix {
  const cX = (viewBox[2] + viewBox[0]) / 2
  const cY = (viewBox[3] + viewBox[1]) / 2
  let A = 1, B = 0, C = 0, D = -1
  if (rotation === 180) { A = -1; B = 0; C = 0; D = 1 }
  else if (rotation === 90) { A = 0; B = 1; C = 1; D = 0 }
  else if (rotation === 270) { A = 0; B = -1; C = -1; D = 0 }
  let ox: number, oy: number
  if (A === 0) { ox = Math.abs(cY - viewBox[1]) * scale; oy = Math.abs(cX - viewBox[0]) * scale }
  else { ox = Math.abs(cX - viewBox[0]) * scale; oy = Math.abs(cY - viewBox[1]) * scale }
  return [A * scale, B * scale, C * scale, D * scale, ox - A * scale * cX - C * scale * cY, oy - B * scale * cX - D * scale * cY]
}

const PAGE: [number, number, number, number] = [0, 0, 600, 400]

describe('composeMatrix', () => {
  it('applies the right-hand matrix first (pdf.js Util.transform order)', () => {
    const scale2: Matrix = [2, 0, 0, 2, 0, 0]
    const shift: Matrix = [1, 0, 0, 1, 10, 20]
    expect(composeMatrix(scale2, shift)).toEqual([2, 0, 0, 2, 20, 40])
    expect(composeMatrix(shift, scale2)).toEqual([2, 0, 0, 2, 10, 20])
  })
})

describe('textItemsToImageSpace', () => {
  it('upright page: baseline, top, height and width land on the scale-2 raster', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    expect(v).toEqual([2, 0, 0, -2, 0, 800])
    const [run] = textItemsToImageSpace([{ str: 'NO:', transform: [10, 0, 0, 10, 50, 300], width: 18, height: 10 }], v)
    expect(run).toEqual({ str: 'NO:', x: 100, baseline: 200, top: 180, width: 36, height: 20 })
  })

  it('/Rotate 90: a run drawn turned +90° in user space reads upright on the raster', () => {
    const v = pdfViewportTransform(PAGE, 90, 2)
    expect(v).toEqual([0, 2, 2, 0, 0, 0])
    // Same glyph, same place on the raster as the upright case above:
    // raster x = 2 * userY, raster baseline = 2 * userX.
    const [run] = textItemsToImageSpace([{ str: 'NO:', transform: [0, 10, -10, 0, 100, 50], width: 18, height: 10 }], v)
    expect(run).toEqual({ str: 'NO:', x: 100, baseline: 200, top: 180, width: 36, height: 20 })
  })

  it('/Rotate 270 is handled by the same maths', () => {
    const v = pdfViewportTransform(PAGE, 270, 2)
    // Under 270 an upright run is drawn turned -90° in user space.
    const [run] = textItemsToImageSpace([{ str: 'CT:', transform: [0, -10, 10, 0, 100, 350], width: 18, height: 10 }], v)
    expect(run.str).toBe('CT:')
    expect(run.height).toBe(20)
    expect(run.width).toBe(36)
    expect(run.top).toBe(run.baseline - 20)
  })

  it('drops vertical, mirrored and blank runs and non-text items', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    const out = textItemsToImageSpace(
      [
        { str: 'VERTICAL', transform: [0, 10, -10, 0, 50, 50], width: 40, height: 10 },
        { str: 'MIRRORED', transform: [-10, 0, 0, 10, 300, 50], width: 40, height: 10 },
        { str: '   ', transform: [10, 0, 0, 10, 50, 50], width: 5, height: 10 },
        { type: 'beginMarkedContent', id: 'mc0' },
        { str: 'KEEP', transform: [10, 0, 0, 10, 50, 50], width: 20, height: 10 },
      ],
      v,
    )
    expect(out.map((r) => r.str)).toEqual(['KEEP'])
  })

  it('collapses inner whitespace and trims', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    const [run] = textItemsToImageSpace([{ str: '  ALPHA   STORE ', transform: [10, 0, 0, 10, 0, 0], width: 60, height: 10 }], v)
    expect(run.str).toBe('ALPHA STORE')
  })
})
