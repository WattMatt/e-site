import { describe, it, expect } from 'vitest'
import { allTextItemsToImageSpace, composeMatrix, textItemsToImageSpace, type Matrix } from './text-space'

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

  it('/Rotate 180: a run drawn turned 180° in user space reads upright on the raster', () => {
    const v = pdfViewportTransform(PAGE, 180, 2)
    expect(v).toEqual([-2, 0, 0, 2, 1200, 0])
    // raster x = 1200 - 2·userX, raster baseline = 2·userY
    const [run] = textItemsToImageSpace([{ str: 'NO:', transform: [-10, 0, 0, -10, 550, 100], width: 18, height: 10 }], v)
    expect(run).toEqual({ str: 'NO:', x: 100, baseline: 200, top: 180, width: 36, height: 20 })
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

describe('allTextItemsToImageSpace', () => {
  it('an upright run comes back exactly as textItemsToImageSpace returns it, on every page rotation', () => {
    const cases: Array<[0 | 90 | 180 | 270, unknown[]]> = [
      [0, [
        { str: 'NO:', transform: [10, 0, 0, 10, 50, 300], width: 18, height: 10 },
        // A slight skew, still within the upright tolerance: unchanged, not boxed.
        { str: 'SKEW', transform: [10, 0.5, 0, 10, 60, 200], width: 24, height: 10 },
        // pdf.js height disagreeing with the transform: the upright path keeps the transform's height.
        { str: 'TALL', transform: [10, 0, 0, 10, 70, 100], width: 24, height: 13 },
        { str: '  ALPHA   STORE ', transform: [10, 0, 0, 10, 0, 0], width: 60, height: 10 },
      ]],
      [90, [{ str: 'NO:', transform: [0, 10, -10, 0, 100, 50], width: 18, height: 10 }]],
      [180, [{ str: 'NO:', transform: [-10, 0, 0, -10, 550, 100], width: 18, height: 10 }]],
      [270, [{ str: 'CT:', transform: [0, -10, 10, 0, 100, 350], width: 18, height: 10 }]],
    ]
    for (const [rotation, items] of cases) {
      const v = pdfViewportTransform(PAGE, rotation, 2)
      const upright = textItemsToImageSpace(items, v)
      expect(upright).toHaveLength(items.length)
      expect(allTextItemsToImageSpace(items, v)).toEqual(upright)
    }
  })

  it('a run turned -90° (reads bottom to top): width is the font height, height the advance width', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    // Corners in user space: (100,100) (100,130) (90,100) (90,130); raster x = 2X, y = 800 - 2Y.
    const item = { str: 'SHOP 7', transform: [0, 10, -10, 0, 100, 100], width: 30, height: 10 }
    expect(textItemsToImageSpace([item], v)).toEqual([])
    expect(allTextItemsToImageSpace([item], v)).toEqual([
      { str: 'SHOP 7', x: 180, top: 540, width: 20, height: 60, baseline: 600 },
    ])
  })

  it('a run turned 45° gives the bounding box of its rotated rectangle', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    const r = Math.SQRT1_2 * 10
    const item = { str: 'SHOP 12', transform: [r, r, -r, r, 100, 100], width: 20, height: 10 }
    expect(textItemsToImageSpace([item], v)).toEqual([])
    const [run] = allTextItemsToImageSpace([item], v)
    // User-space corners: (100,100), (100+10√2, 100+10√2), (100-5√2, 100+5√2), (100+5√2, 100+15√2).
    const minX = 2 * (100 - 5 * Math.SQRT2)
    const maxX = 2 * (100 + 10 * Math.SQRT2)
    const minY = 800 - 2 * (100 + 15 * Math.SQRT2)
    const maxY = 800 - 2 * 100
    expect(run!.str).toBe('SHOP 12')
    expect(run!.x).toBeCloseTo(minX, 2)
    expect(run!.x + run!.width).toBeCloseTo(maxX, 2)
    expect(run!.top).toBeCloseTo(minY, 2)
    expect(run!.top + run!.height).toBeCloseTo(maxY, 2)
    expect(run!.baseline).toBeCloseTo(maxY, 2)
  })

  it('a page rotation and a turned run compose: the raster box, not the user-space one', () => {
    // /Rotate 90: raster x = 2·userY, raster y = 2·userX. A run drawn turned 180° in user
    // space reads bottom to top on the raster, like the -90° case above.
    const v = pdfViewportTransform(PAGE, 90, 2)
    const item = { str: 'SHOP 7', transform: [-10, 0, 0, -10, 350, 250], width: 30, height: 10 }
    expect(textItemsToImageSpace([item], v)).toEqual([])
    // User corners: (350,250) (320,250) (350,240) (320,240) → raster x 480..500, y 640..700.
    const [run] = allTextItemsToImageSpace([item], v)
    expect(run!.str).toBe('SHOP 7')
    expect(run!.x).toBeCloseTo(480, 6)
    expect(run!.width).toBeCloseTo(20, 6)
    expect(run!.top).toBeCloseTo(640, 6)
    expect(run!.height).toBeCloseTo(60, 6)
    expect(run!.baseline).toBeCloseTo(700, 6)
  })

  it('drops blank runs, non-text items and degenerate transforms; keeps mirrored and vertical runs', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    const out = allTextItemsToImageSpace(
      [
        { str: 'VERTICAL', transform: [0, 10, -10, 0, 50, 50], width: 40, height: 10 },
        { str: 'MIRRORED', transform: [-10, 0, 0, 10, 300, 50], width: 40, height: 10 },
        { str: '   ', transform: [0, 10, -10, 0, 50, 50], width: 5, height: 10 },
        { type: 'beginMarkedContent', id: 'mc0' },
        { str: 'FLAT', transform: [0, 0, 0, 0, 50, 50], width: 20, height: 10 },
        { str: 'NO RUN', transform: [0, 0, -10, 0, 50, 50], width: 20, height: 10 },
        { str: 'NO RISE', transform: [0, 10, 0, 0, 50, 50], width: 20, height: 10 },
        { str: 'KEEP', transform: [10, 0, 0, 10, 50, 50], width: 20, height: 10 },
      ],
      v,
    )
    expect(out.map((r) => r.str)).toEqual(['VERTICAL', 'MIRRORED', 'KEEP'])
  })
})
