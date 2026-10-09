// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, degrees } from 'pdf-lib'
import {
  normaliseRotation, viewedSize, imageToPdfPoint, placementFor, applyMatrix, imageToOutput,
  type PageBox, type QuarterTurn,
} from './pdf-geometry'

const BOX: PageBox = { x: 0, y: 0, width: 600, height: 400 }
const OFFSET: PageBox = { x: 50, y: 20, width: 600, height: 400 }
const TURNS: QuarterTurn[] = [0, 90, 180, 270]

describe('normaliseRotation', () => {
  it('folds any multiple of 90 into 0..270 and refuses the rest like pdf.js does', () => {
    expect(normaliseRotation(0)).toBe(0)
    expect(normaliseRotation(90)).toBe(90)
    expect(normaliseRotation(-90)).toBe(270)
    expect(normaliseRotation(450)).toBe(90)
    expect(normaliseRotation(-540)).toBe(180)
    expect(normaliseRotation(45)).toBe(0)
    expect(normaliseRotation(Number.NaN)).toBe(0)
  })
})

describe('viewedSize', () => {
  it('swaps width and height for a quarter turn', () => {
    expect(viewedSize(BOX, 0)).toEqual({ width: 600, height: 400 })
    expect(viewedSize(BOX, 90)).toEqual({ width: 400, height: 600 })
    expect(viewedSize(BOX, 180)).toEqual({ width: 600, height: 400 })
    expect(viewedSize(BOX, 270)).toEqual({ width: 400, height: 600 })
  })
})

describe('imageToPdfPoint — hand table (viewed point (100 pt, 50 pt) = image px (200, 100))', () => {
  // /Rotate turns the page CLOCKWISE for display (PDF 32000 §7.7.3.3).
  it.each([
    [0, BOX, { x: 100, y: 350 }],
    [90, BOX, { x: 50, y: 100 }],
    [180, BOX, { x: 500, y: 50 }],
    [270, BOX, { x: 550, y: 300 }],
    [90, OFFSET, { x: 100, y: 120 }],
  ] as const)('rotate %i', (r, box, want) => {
    const got = imageToPdfPoint({ x: 200, y: 100 }, box, r)
    expect(got.x).toBeCloseTo(want.x, 9)
    expect(got.y).toBeCloseTo(want.y, 9)
  })
  it('a raster drawing is 1 px per unit and never rotated', () => {
    expect(imageToPdfPoint({ x: 200, y: 100 }, { x: 0, y: 0, width: 400, height: 200 }, 0, 1)).toEqual({ x: 200, y: 100 })
  })
})

describe('placementFor', () => {
  it('a frame of exactly the viewed size is 1:1', () => {
    const p = placementFor(BOX, 90, { x: 0, y: 30, width: 400, height: 600 })
    expect(p.scale).toBe(1)
    expect(p.drawn).toEqual({ x: 0, y: 30, width: 400, height: 600 })
  })
  it('fits and centres in a larger frame, keeping the aspect ratio', () => {
    const p = placementFor(BOX, 0, { x: 0, y: 0, width: 1000, height: 600 })
    expect(p.scale).toBeCloseTo(1.5, 9)
    expect(p.drawn).toEqual({ x: 50, y: 0, width: 900, height: 600 })
  })
  it.each(TURNS)('rotate %i: the matrix maps the form box onto the drawn rectangle', (r) => {
    const p = placementFor(OFFSET, r, { x: 10, y: 20, width: 700, height: 500 })
    const corners = [[0, 0], [600, 0], [600, 400], [0, 400]].map(([x, y]) => applyMatrix(p.matrix, { x: x!, y: y! }))
    const d = p.drawn
    const want = [[d.x, d.y], [d.x + d.width, d.y], [d.x + d.width, d.y + d.height], [d.x, d.y + d.height]]
    const key = (q: { x: number; y: number }) => `${q.x.toFixed(6)},${q.y.toFixed(6)}`
    expect(new Set(corners.map(key))).toEqual(new Set(want.map(([x, y]) => key({ x: x!, y: y! }))))
  })
})

describe('imageToOutput', () => {
  // Second derivation, independent of the matrix algebra: on the output page the viewed sheet sits in
  // `drawn`, y up, so image px (u, v) lands at (drawn.x + k·u/2, drawn.top − k·v/2).
  it.each(TURNS)('rotate %i agrees with the viewed-sheet derivation', (r) => {
    const p = placementFor(OFFSET, r, { x: 24, y: 70, width: 950, height: 700 })
    const v = viewedSize(OFFSET, r)
    for (const [u, w] of [[0, 0], [v.width * 2, v.height * 2], [123.4, 77.7], [640, 10]]) {
      const got = imageToOutput({ x: u!, y: w! }, OFFSET, r, p)
      expect(got.x).toBeCloseTo(p.drawn.x + (p.scale * u!) / 2, 6)
      expect(got.y).toBeCloseTo(p.drawn.y + p.drawn.height - (p.scale * w!) / 2, 6)
    }
  })
})

describe('imageToPdfPoint — pdf.js is the oracle', () => {
  // The live viewer maps with pdf.js; this asserts our inverse against pdf.js's own convertToPdfPoint.
  async function pdfjs() {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const req = createRequire(import.meta.url)
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    return lib
  }
  it.each(TURNS)('matches getViewport({ scale: 2 }) for /Rotate %i on an offset MediaBox', async (r) => {
    const d = await PDFDocument.create()
    const page = d.addPage([600, 400])
    page.setMediaBox(50, 20, 600, 400)
    page.setRotation(degrees(r))
    const box = page.getCropBox()
    const lib = await pdfjs()
    const doc = await lib.getDocument({ data: await d.save() }).promise
    const vp = (await doc.getPage(1)).getViewport({ scale: 2 })
    for (const [vx, vy] of [[0, 0], [vp.width, 0], [vp.width, vp.height], [123.4, 77.7]]) {
      const [ex, ey] = vp.convertToPdfPoint(vx!, vy!) as [number, number]
      const got = imageToPdfPoint({ x: vx!, y: vy! }, box, r)
      expect(got.x).toBeCloseTo(ex, 6)
      expect(got.y).toBeCloseTo(ey, 6)
    }
    await doc.destroy()
  })
})
