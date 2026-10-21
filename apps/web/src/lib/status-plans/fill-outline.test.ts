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
function room(
  set: (x: number, y: number) => void,
  x0: number,
  y0: number,
  w: number,
  h: number,
  gap?: { wall: 'right' | 'bottom'; at: number; len: number },
) {
  // The gap, when asked for, is cut out of the named wall from `at` for `len` pixels.
  const inGap = (wall: 'right' | 'bottom', v: number) => gap?.wall === wall && v >= gap.at && v < gap.at + gap.len
  for (let x = x0; x <= x0 + w; x++) {
    set(x, y0)
    if (!inGap('bottom', x)) set(x, y0 + h)
  }
  for (let y = y0; y <= y0 + h; y++) {
    set(x0, y)
    if (!inGap('right', y)) set(x0 + w, y)
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

  it('seeds the whole grid when the anchor is free but sits between two glyphs', () => {
    // Two glyph blobs bridged top and bottom (as dilated letters touch), leaving a 3 px free gap
    // between them in the mask. The anchor is in that gap: it is free, but its region is the gap.
    const mask = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => {
        room(set, 400, 300, 120, 80)
        for (let y = 335; y <= 345; y++) {
          for (let x = 450; x <= 456; x++) set(x, y)
          for (let x = 462; x <= 468; x++) set(x, y)
        }
        for (let x = 450; x <= 468; x++) {
          set(x, 335)
          set(x, 345)
        }
      }),
    )
    const anchor = { x: 459, y: 340 }
    expect(mask.ink[anchor.y * PAGE_W + anchor.x]).toBe(0)
    // The gap after dilation: x 458..460, y 337..343, closed on all four sides.
    const gap = enclosedFree(mask, 457, 336, 461, 344)
    expect(gap).toBe(3 * 7)
    expect(mask.ink[340 * PAGE_W + 457]).toBe(1)
    expect(mask.ink[340 * PAGE_W + 461]).toBe(1)
    expect(mask.ink[336 * PAGE_W + 459]).toBe(1)
    expect(mask.ink[344 * PAGE_W + 459]).toBe(1)
    const interior = enclosedFree(mask, 400, 300, 520, 380) - gap
    const ok = expectOk(fillFromAnchor(mask, anchor))
    expect(Math.abs(ok.pixels - interior) / interior).toBeLessThan(0.01)
  })

  it('a 3 px gap in one wall leaks', () => {
    const closed = inkMaskFromImageData(raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80)))
    // Control: the same room without the gap fills.
    expect(fillFromAnchor(closed, { x: 460, y: 340 }).kind).toBe('ok')
    const gapped = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80, { wall: 'right', at: 338, len: 3 })),
    )
    expect(fillFromAnchor(gapped, { x: 460, y: 340 })).toEqual({ kind: 'leak' })
  })

  it('an ink anchor in a gapped room still leaks', () => {
    // A glyph blob at the anchor sends the fill to the seed grid. Whichever seed reaches the gap
    // first aborts at the cap; no later seed may then fill the leftover and report it as a shop.
    // The gap is slid along the whole bottom wall so every seed order is exercised.
    for (let at = 402; at <= 516; at += 3) {
      const mask = inkMaskFromImageData(
        raster(PAGE_W, PAGE_H, (set) => {
          room(set, 400, 300, 120, 80, { wall: 'bottom', at, len: 3 })
          for (let y = 337; y <= 343; y++) for (let x = 455; x <= 465; x++) set(x, y)
        }),
      )
      expect(mask.ink[340 * PAGE_W + 460]).toBe(1)
      expect({ at, outcome: fillFromAnchor(mask, { x: 460, y: 340 }) }).toEqual({ at, outcome: { kind: 'leak' } })
    }
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
    // The gate measures the grown polygon: x 400..460 × y 300..380 is 61 × 81 = 4,941 px, which at
    // 10 px per metre is 49.41 m² (0.55 of the GLA); the schedule says the whole room, 90.1 m².
    expect(shapeAreaPx(ok.polygon)).toBe(61 * 81)
    const gate = gateSuggestion(outcome, 10, 90.1, [])
    expect(gate).toEqual({
      offered: false,
      reason: 'The fill came to 49.4 m² for a 90.1 m² shop, not offered.',
      fillM2: 49.41,
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

  it('the gate measures the grown polygon', () => {
    // A 109 × 109 wall square: free interior 106 × 106 = 11,236 px, grown by GROW_PX to
    // 110 × 110 = 12,100 px (no holes, so the polygon is exactly that). At 10 px per metre and a
    // 144.05 m² GLA the ungrown region is 0.78 × GLA (below the band) and the polygon 0.84 × GLA.
    const outcome = fillFromAnchor(inkMaskFromImageData(raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 109, 109))), {
      x: 454,
      y: 354,
    })
    const ok = expectOk(outcome)
    expect(ok.pixels).toBe(106 * 106)
    expect(ok.pixels / 100 / 144.05).toBeCloseTo(0.78, 3)
    const polygonPx = shapeAreaPx(ok.polygon)
    expect(polygonPx).toBe(110 * 110)
    expect(polygonPx / 100 / 144.05).toBeCloseTo(0.84, 3)
    const gate = gateSuggestion(outcome, 10, 144.05, [])
    expect(gate.offered).toBe(true)
    if (!gate.offered) throw new Error('not offered')
    expect(Math.abs(gate.fillM2 - polygonPx / 100) / (polygonPx / 100)).toBeLessThan(0.005)
  })

  it('a region smaller than minPixels is never the winner: a glyph counter in a gapped room is a leak', () => {
    // An "O" at the anchor: its counter (x 438..456 × y 334..346 after dilation, 247 px) is the only
    // enclosed pocket, because the room around it has a 3 px gap in its right wall.
    const glyph = (set: (x: number, y: number) => void) => {
      for (let x = 436; x <= 462; x++) {
        set(x, 332)
        set(x, 348)
      }
      for (let y = 332; y <= 348; y++) {
        set(436, y)
        for (let x = 458; x <= 462; x++) set(x, y)
      }
    }
    const anchor = { x: 447, y: 340 }
    const gapped = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => {
        room(set, 400, 300, 120, 80, { wall: 'right', at: 338, len: 3 })
        glyph(set)
      }),
    )
    expect(gapped.ink[anchor.y * PAGE_W + anchor.x]).toBe(0)
    const counter = enclosedFree(gapped, 436, 332, 462, 348)
    expect(counter).toBe(19 * 13)
    // Without a floor the counter wins and reads as a 247 px "shop".
    expect(expectOk(fillFromAnchor(gapped, anchor)).pixels).toBe(counter)
    // With the label's box area as the floor, nothing is left but the leak.
    expect(fillFromAnchor(gapped, anchor, { minPixels: 400 })).toEqual({ kind: 'leak' })
    // Control: the same glyph in a closed room still fills the room.
    const closed = inkMaskFromImageData(
      raster(PAGE_W, PAGE_H, (set) => {
        room(set, 400, 300, 120, 80)
        glyph(set)
      }),
    )
    expect(expectOk(fillFromAnchor(closed, anchor, { minPixels: 400 })).pixels).toBe(
      enclosedFree(closed, 400, 300, 520, 380) - counter,
    )
    // Nothing leaked and nothing reached the floor: no region.
    const w = 60
    const h = 40
    const ink = new Uint8Array(w * h).fill(1)
    for (let y = 18; y < 23; y++) for (let x = 28; x < 33; x++) ink[y * w + x] = 0
    expect(expectOk(fillFromAnchor({ width: w, height: h, ink }, { x: 30, y: 20 })).pixels).toBe(25)
    expect(fillFromAnchor({ width: w, height: h, ink }, { x: 30, y: 20 }, { minPixels: 100 })).toEqual({ kind: 'no_region' })
  })

  it('the gate refuses a fill that encloses another label, before the GLA and the band', () => {
    // Grown polygon 121 × 81 = 9,801 px = 98.01 m² at 10 px/m; in band for a 100 m² GLA.
    const outcome = fillFromAnchor(inkMaskFromImageData(raster(PAGE_W, PAGE_H, (set) => room(set, 400, 300, 120, 80))), {
      x: 460,
      y: 340,
    })
    expectOk(outcome)
    const inside = { x: 500, y: 360, tag: '62' }
    const outside = { x: 600, y: 340, tag: '62' }
    const covers = { offered: false, reason: 'The fill covers SHOP 62 as well; draw this shop by hand.', fillM2: 98.01 }
    expect(gateSuggestion(outcome, 10, 100, [inside])).toEqual(covers)
    expect(gateSuggestion(outcome, 10, 100, [outside])).toEqual({ offered: true, fillM2: 98.01, glaM2: 100 })
    // It is checked before the GLA and the band, and names the first enclosed label.
    expect(gateSuggestion(outcome, 10, null, [inside])).toEqual(covers)
    expect(gateSuggestion(outcome, 10, 300, [inside])).toEqual(covers)
    expect(gateSuggestion(outcome, 10, 100, [outside, { x: 410, y: 310, tag: '64' }, inside])).toMatchObject({
      reason: 'The fill covers SHOP 64 as well; draw this shop by hand.',
    })
    // Scale still comes first; a leak never reaches the check.
    expect(gateSuggestion(outcome, null, 100, [inside])).toEqual({ offered: false, reason: 'Calibrate the sheet first.', fillM2: null })
    expect(gateSuggestion({ kind: 'leak' }, 10, 100, [inside]).offered).toBe(false)
  })

  it('gate: no scale, no GLA, leak, out of band, in band', () => {
    // The gate measures the polygon: 200 × 200 = 40,000 px at 20 px per metre is 100 m². `pixels` and
    // `grownPixels` are diagnostics only.
    const ok: FillOutcome = { kind: 'ok', pixels: 40_000, grownPixels: 41_000, polygon: [0, 0, 200, 0, 200, 200, 0, 200] }

    expect(gateSuggestion(ok, null, 100, [])).toEqual({ offered: false, reason: 'Calibrate the sheet first.', fillM2: null })
    expect(gateSuggestion(ok, 20, null, [])).toEqual({ offered: false, reason: 'No GLA on the schedule for this shop.', fillM2: 100 })
    expect(gateSuggestion({ kind: 'leak' }, 20, 100, [])).toEqual({
      offered: false,
      reason: 'The fill ran into the mall; draw this shop by hand.',
      fillM2: null,
    })
    expect(gateSuggestion(ok, 20, 50.2, [])).toEqual({
      offered: false,
      reason: 'The fill came to 100.0 m² for a 50.2 m² shop, not offered.',
      fillM2: 100,
    })
    expect(gateSuggestion(ok, 20, 110, [])).toEqual({ offered: true, fillM2: 100, glaM2: 110 })

    // The band is inclusive at both ends, and a zero or negative scale or GLA fails closed.
    // (100 m² / 125 m² is exactly 0.8; 120 m² / 100 m² is exactly 1.2.)
    expect(gateSuggestion(ok, 20, 125, []).offered).toBe(true)
    const big: FillOutcome = { ...ok, polygon: [0, 0, 240, 0, 240, 200, 0, 200] } // 48,000 px
    expect(gateSuggestion(big, 20, 100, [])).toEqual({ offered: true, fillM2: 120, glaM2: 100 })
    expect(gateSuggestion(big, 20, 99.9, []).offered).toBe(false)
    expect(gateSuggestion(ok, 20, 125.1, []).offered).toBe(false)
    expect(gateSuggestion(ok, 0, 100, [])).toMatchObject({ offered: false, reason: 'Calibrate the sheet first.' })
    expect(gateSuggestion(ok, 20, 0, [])).toMatchObject({ offered: false, reason: 'No GLA on the schedule for this shop.' })
    expect(gateSuggestion({ kind: 'no_region' }, 20, 100, [])).toEqual({
      offered: false,
      reason: 'No white space at the label.',
      fillM2: null,
    })
  })
})
