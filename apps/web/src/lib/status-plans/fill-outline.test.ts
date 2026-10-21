import { describe, it, expect } from 'vitest'
import { shapeAreaPx } from '@esite/shared/status-plans'
import {
  GATE_BAND,
  GROW_PX,
  INK_LUMA,
  LEAK_CAP,
  MAX_VERTICES,
  SEED_GRID,
  SIMPLIFY_EPS_PX,
  fillFromAnchor,
  gateSuggestion,
  inkMaskFromImageData,
  type FillOutcome,
  type InkMask,
} from './fill-outline'

type Raster = { width: number; height: number; data: Uint8ClampedArray }

/** An ImageData-shaped white page; `set` paints one pixel black (ink). */
function raster(w: number, h: number, draw: (set: (x: number, y: number) => void) => void): Raster {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  draw((x, y) => {
    const i = (y * w + x) * 4
    data[i] = 0
    data[i + 1] = 0
    data[i + 2] = 0
  })
  return { width: w, height: h, data }
}

/** A rectangle of 1 px walls with its corners at (x0, y0) and (x0 + w, y0 + h). */
function room(set: (x: number, y: number) => void, x0: number, y0: number, w: number, h: number, gap?: { y: number; len: number }) {
  for (let x = x0; x <= x0 + w; x++) {
    set(x, y0)
    set(x, y0 + h)
  }
  for (let y = y0; y <= y0 + h; y++) {
    set(x0, y)
    // The gap, when asked for, is cut out of the right-hand wall.
    if (gap && y >= gap.y && y < gap.y + gap.len) continue
    set(x0 + w, y)
  }
}

/** Non-ink pixels strictly inside a wall rectangle, read from the mask. */
function enclosedFree(mask: InkMask, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0
  for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) if (!mask.ink[y * mask.width + x]) n++
  return n
}

function vertices(polygon: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < polygon.length; i += 2) out.push([polygon[i], polygon[i + 1]])
  return out
}

function expectOk(outcome: FillOutcome): Extract<FillOutcome, { kind: 'ok' }> {
  expect(outcome.kind).toBe('ok')
  if (outcome.kind !== 'ok') throw new Error('not ok')
  return outcome
}

// A page big enough that a 120 × 80 room is well under LEAK_CAP (1000 × 800 × 1.5 % = 12,000 px),
// while the outside of the room is far over it.
const PAGE_W = 1000
const PAGE_H = 800

describe('fill-outline constants', () => {
  it('carry the values the spec names', () => {
    expect([INK_LUMA, LEAK_CAP, GROW_PX, SIMPLIFY_EPS_PX, MAX_VERTICES]).toEqual([170, 0.015, 2, 2, 1000])
    expect(SEED_GRID).toEqual({ dx: 24, dy: 16, step: 8 })
    expect(GATE_BAND).toEqual({ min: 0.8, max: 1.2 })
  })
})

describe('fill-outline', () => {
  it('inkMaskFromImageData thresholds at INK_LUMA and dilates by one pixel', () => {
    const w = 20
    const h = 10
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const paint = (x: number, y: number, v: number) => {
      const i = (y * w + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
    }
    paint(4, 4, INK_LUMA - 1) // just dark enough: ink
    paint(14, 4, INK_LUMA) // exactly at the threshold: not ink
    const mask = inkMaskFromImageData({ width: w, height: h, data })
    expect(mask.width).toBe(w)
    expect(mask.height).toBe(h)
    const at = (x: number, y: number) => mask.ink[y * w + x]
    // The ink pixel and its eight neighbours.
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) expect(at(x, y)).toBe(1)
    // Two pixels away is untouched.
    expect(at(6, 4)).toBe(0)
    expect(at(4, 6)).toBe(0)
    expect(at(2, 2)).toBe(0)
    // The pixel at the threshold produced nothing.
    for (let y = 3; y <= 5; y++) for (let x = 13; x <= 15; x++) expect(at(x, y)).toBe(0)
    let total = 0
    for (const v of mask.ink) total += v
    expect(total).toBe(9)
  })

  it('fills a closed 120×80 room from its centre: pixels within 1 % of the interior, polygon area within 1 % of the pixel count', () => {
    const mask = inkMaskFromImageData(raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80)))
    const interior = enclosedFree(mask, 400, 300, 520, 380)
    const ok = expectOk(fillFromAnchor(mask, { x: 460, y: 340 }))
    expect(Math.abs(ok.pixels - interior) / interior).toBeLessThan(0.01)
    expect(Math.abs(shapeAreaPx(ok.polygon) - ok.grownPixels) / ok.grownPixels).toBeLessThan(0.01)
  })

  it('seeds from a grid when the anchor is ink', () => {
    const mask = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => {
        room(set, 400, 300, 120, 80)
        // A glyph blob under the anchor, smaller than one grid step either side.
        for (let y = 337; y <= 343; y++) for (let x = 455; x <= 465; x++) set(x, y)
      }),
    )
    const anchor = { x: 460, y: 340 }
    expect(mask.ink[anchor.y * PAGE_W + anchor.x]).toBe(1)
    const interior = enclosedFree(mask, 400, 300, 520, 380)
    const ok = expectOk(fillFromAnchor(mask, anchor))
    expect(Math.abs(ok.pixels - interior) / interior).toBeLessThan(0.01)

    // A glyph with a counter (an "O"): the first grid point probed lands inside the counter, but the
    // largest region under the cap wins, which is the room around the label.
    const withCounter = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => {
        room(set, 400, 300, 120, 80)
        for (let x = 436; x <= 462; x++) {
          set(x, 332)
          set(x, 348)
        }
        for (let y = 332; y <= 348; y++) {
          set(436, y)
          for (let x = 458; x <= 462; x++) set(x, y) // a thick right stroke under the anchor
        }
      }),
    )
    expect(withCounter.ink[anchor.y * PAGE_W + anchor.x]).toBe(1)
    expect(withCounter.ink[340 * PAGE_W + 452]).toBe(0) // the first probe, inside the counter
    const counter = enclosedFree(withCounter, 436, 332, 462, 348)
    expect(counter).toBe(19 * 13)
    const roomFill = expectOk(fillFromAnchor(withCounter, anchor))
    expect(roomFill.pixels).toBe(enclosedFree(withCounter, 400, 300, 520, 380) - counter)
  })

  it('a 3 px gap in one wall leaks', () => {
    const closed = inkMaskFromImageData(raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80)))
    // Control: the same room without the gap fills.
    expect(fillFromAnchor(closed, { x: 460, y: 340 }).kind).toBe('ok')
    const gapped = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80, { y: 338, len: 3 })),
    )
    expect(fillFromAnchor(gapped, { x: 460, y: 340 })).toEqual({ kind: 'leak' })
  })

  it('an interior line halves the region, so the gate refuses it with the numbers', () => {
    const mask = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => {
        room(set, 400, 300, 120, 80)
        for (let y = 300; y <= 380; y++) set(460, y)
      }),
    )
    const outcome = fillFromAnchor(mask, { x: 430, y: 340 })
    const ok = expectOk(outcome)
    // Left half after dilation: x 402..458, y 302..378.
    expect(ok.pixels).toBe(enclosedFree(mask, 400, 300, 460, 380))
    expect(ok.pixels).toBe(57 * 77)
    // 10 px per metre: 4,389 px is 43.89 m²; the schedule says the whole room, 90.1 m².
    const gate = gateSuggestion(outcome, 10, 90.1)
    expect(gate).toEqual({
      offered: false,
      reason: 'The fill came to 43.9 m² for a 90.1 m² shop, not offered.',
      fillM2: 43.89,
    })
  })

  it('polygon is grown by GROW_PX, simplified at SIMPLIFY_EPS_PX, and capped at MAX_VERTICES', () => {
    // Grown: the room's free interior is x 402..518, y 302..378; grown by 2 px its pixel edges sit at 400..521 × 300..381.
    const rect = expectOk(
      fillFromAnchor(inkMaskFromImageData(raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80))), { x: 460, y: 340 }),
    )
    expect(rect.pixels).toBe(117 * 77)
    expect(rect.grownPixels).toBe((117 + 2 * GROW_PX) * (77 + 2 * GROW_PX))
    expect(new Set(vertices(rect.polygon).map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(['400,300', '521,300', '521,381', '400,381']),
    )
    expect(shapeAreaPx(rect.polygon)).toBe(rect.grownPixels)

    // Simplified: a right triangle whose hypotenuse is a pixel staircase traces to hundreds of
    // corners; Douglas–Peucker at 2 px brings it down to a handful.
    const tri = expectOk(
      fillFromAnchor(
        inkMaskFromImageData(
          raster(PAGE_W, PAGE_H, (set) => {
            for (let x = 400; x <= 520; x++) set(x, 380) // bottom
            for (let y = 300; y <= 380; y++) set(400, y) // left
            for (let x = 400; x <= 520; x++) set(x, Math.round(300 + ((x - 400) * 80) / 120)) // staircase
          }),
        ),
        { x: 430, y: 365 },
      ),
    )
    expect(tri.polygon.length / 2).toBeLessThanOrEqual(10)
    // Every traced corner stays within ε of the simplified outline, so the area can move by at most
    // ε × perimeter (a small triangle's thin corners make that more than 1 %).
    const triPts = vertices(tri.polygon)
    let perimeter = 0
    triPts.forEach(([x, y], i) => {
      const [nx, ny] = triPts[(i + 1) % triPts.length]
      perimeter += Math.hypot(nx - x, ny - y)
    })
    expect(Math.abs(shapeAreaPx(tri.polygon) - tri.grownPixels)).toBeLessThanOrEqual(SIMPLIFY_EPS_PX * perimeter)
    expect(Math.abs(shapeAreaPx(tri.polygon) - tri.grownPixels) / tri.grownPixels).toBeLessThan(0.03)

    // Capped: a comb of 300 teeth (4 px wide, 8 px apart, 20 px tall) needs about 1,200 corners at
    // 2 px; ε doubles until the outline fits MAX_VERTICES, and the teeth still show.
    const w = 3700
    const h = 800
    const ink = new Uint8Array(w * h).fill(1)
    for (let y = 50; y < 53; y++) for (let x = 50; x < 50 + 3600; x++) ink[y * w + x] = 0
    for (let t = 0; t < 300; t++) {
      for (let y = 53; y < 73; y++) for (let x = 50 + 12 * t; x < 54 + 12 * t; x++) ink[y * w + x] = 0
    }
    const comb = expectOk(fillFromAnchor({ width: w, height: h, ink }, { x: 60, y: 51 }))
    expect(comb.pixels).toBe(3 * 3600 + 300 * 4 * 20)
    expect(comb.polygon.length / 2).toBeLessThanOrEqual(MAX_VERTICES)
    expect(comb.polygon.length / 2).toBeGreaterThan(300)
  })

  it('gate: no scale, no GLA, leak, out of band, in band', () => {
    // 40,000 px at 20 px per metre is 100 m².
    const ok: FillOutcome = { kind: 'ok', pixels: 40_000, grownPixels: 41_000, polygon: [0, 0, 200, 0, 200, 200, 0, 200] }

    expect(gateSuggestion(ok, null, 100)).toEqual({ offered: false, reason: 'Calibrate the sheet first.', fillM2: null })
    expect(gateSuggestion(ok, 20, null)).toEqual({ offered: false, reason: 'No GLA on the schedule for this shop.', fillM2: 100 })
    expect(gateSuggestion({ kind: 'leak' }, 20, 100)).toEqual({
      offered: false,
      reason: 'The fill ran into the mall; draw this shop by hand.',
      fillM2: null,
    })
    expect(gateSuggestion(ok, 20, 50.2)).toEqual({
      offered: false,
      reason: 'The fill came to 100.0 m² for a 50.2 m² shop, not offered.',
      fillM2: 100,
    })
    expect(gateSuggestion(ok, 20, 110)).toEqual({ offered: true, fillM2: 100, glaM2: 110 })

    // The band is inclusive at both ends, and a zero or negative scale or GLA fails closed.
    // (100 m² / 125 m² is exactly 0.8; 120 m² / 100 m² is exactly 1.2.)
    expect(gateSuggestion(ok, 20, 125).offered).toBe(true)
    const big: FillOutcome = { ...ok, pixels: 48_000 }
    expect(gateSuggestion(big, 20, 100)).toEqual({ offered: true, fillM2: 120, glaM2: 100 })
    expect(gateSuggestion(big, 20, 99.9).offered).toBe(false)
    expect(gateSuggestion(ok, 20, 125.1).offered).toBe(false)
    expect(gateSuggestion(ok, 0, 100)).toMatchObject({ offered: false, reason: 'Calibrate the sheet first.' })
    expect(gateSuggestion(ok, 20, 0)).toMatchObject({ offered: false, reason: 'No GLA on the schedule for this shop.' })
    expect(gateSuggestion({ kind: 'no_region' }, 20, 100)).toEqual({
      offered: false,
      reason: 'No white space at the label.',
      fillM2: null,
    })
  })
})
