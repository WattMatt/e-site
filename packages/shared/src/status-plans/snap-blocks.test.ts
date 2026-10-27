import { describe, it, expect } from 'vitest'
import { detectBlocks, type DetectedBlock } from './detect-blocks'
import { rectToPoints } from './geometry'
import type { LineSegment } from './line-space'
import { snapBlock, snapBlocks } from './snap-blocks'
import { ALPHA, BRAVO, DELTA_NO_TAG, H, PITCH, blockItems } from './__fixtures__/db-block-layout'

/*
 * Invented geometry. ALPHA at x=100, NO: baseline 100, h=10, rows 16 apart:
 * text runs from x=100 (labels) to x=216 (widest value), NO: top 90, CT:
 * baseline 196. The table drawn round it (as a CAD block would):
 * outer border 97..240 × 87..201, label/value divider at x=146, a row line
 * 5 px under each baseline. The right border sits 2.4h past the longest
 * value — the gap a text-only box misses.
 */
const T = { left: 97, top: 87, right: 240, bottom: 201, divider: 146 }

const h = (at: number, from: number, to: number): LineSegment => ({ axis: 'h', at, from, to })
const v = (at: number, from: number, to: number): LineSegment => ({ axis: 'v', at, from, to })

interface Table { left: number; top: number; right: number; bottom: number; divider: number; noBaseline: number; pitch?: number }

/** The table drawn the way the real sheets draw it: outer rectangle, divider, a row line under each row but the last. */
function tableLines(t: Table, omit: { right?: boolean } = {}): LineSegment[] {
  const pitch = t.pitch ?? PITCH
  const out = [h(t.top, t.left, t.right), h(t.bottom, t.left, t.right), v(t.left, t.top, t.bottom), v(t.divider, t.top, t.bottom)]
  if (!omit.right) out.push(v(t.right, t.top, t.bottom))
  for (let row = 0; row < 6; row++) out.push(h(t.noBaseline + row * pitch + 5, t.left, t.right))
  return out
}

function alpha(): DetectedBlock {
  return detectBlocks(blockItems({ x: 100, y: 100, values: ALPHA })).blocks[0]!
}

const ALPHA_TABLE: Table = { ...T, noBaseline: 100 }

describe('snapBlock — a clean table', () => {
  it('snaps every edge onto the table border, past the longest value to the outer right border', () => {
    const b = snapBlock(alpha(), tableLines(ALPHA_TABLE))
    expect(b.snapped).toBe(true)
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
    expect(b.points).toEqual(rectToPoints(97, 87, 240, 201))
  })

  it('keeps everything else the detector read', () => {
    const before = alpha()
    const b = snapBlock(before, tableLines(ALPHA_TABLE))
    expect(b.tag).toBe('DB-71')
    expect(b.fields).toEqual(before.fields)
    expect(b.text).toEqual(before.text)
  })

  it('reads a border drawn cell by cell (one short segment per row) as one line', () => {
    const lines = tableLines(ALPHA_TABLE).filter((s) => !(s.axis === 'v' && (s.at === T.left || s.at === T.right)))
    const edges = [T.top, 105, 121, 137, 153, 169, 185, T.bottom]
    for (let i = 0; i + 1 < edges.length; i++) lines.push(v(T.left, edges[i]!, edges[i + 1]!), v(T.right, edges[i]!, edges[i + 1]!))
    const b = snapBlock(alpha(), lines)
    expect(b.snapped).toBe(true)
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
  })

  it('ignores a feeder line that only touches the table (it does not span the block)', () => {
    const lines = [...tableLines(ALPHA_TABLE), v(230, 40, T.top), v(230, T.bottom, 260), v(225, 150, 175)]
    const b = snapBlock(alpha(), lines)
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
  })
})

describe('snapBlock — the internal divider', () => {
  it('a block with no values at all does not stop at the label/value divider', () => {
    // Every value empty: the text ends at the widest label (SERIAL: → 142), left of the divider.
    const empty = detectBlocks(blockItems({ x: 100, y: 100, values: ['', '', '', '', '', '', ''] })).blocks[0]!
    expect(empty.text.maxX).toBeLessThan(T.divider)
    const b = snapBlock(empty, tableLines(ALPHA_TABLE))
    expect(b.snapped).toBe(true)
    expect(b.box.maxX).toBe(240)
  })
})

describe('snapBlock — a neighbouring table close by', () => {
  it('does not take the neighbour’s border, left or right', () => {
    // BRAVO's table 6 px right of ALPHA's; another table 6 px left.
    const right: Table = { left: 246, top: 87, right: 380, bottom: 201, divider: 295, noBaseline: 100 }
    const left: Table = { left: -50, top: 87, right: 91, bottom: 201, divider: 0, noBaseline: 100 }
    const lines = [...tableLines(ALPHA_TABLE), ...tableLines(right), ...tableLines(left)]
    const b = snapBlock(alpha(), lines)
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
  })

  it('does not take the border of a table stacked just above or below', () => {
    const above: Table = { left: 97, top: -40, right: 240, bottom: 82, divider: 146, noBaseline: -20 }
    const below: Table = { left: 97, top: 206, right: 240, bottom: 330, divider: 146, noBaseline: 220 }
    const b = snapBlock(alpha(), [...tableLines(ALPHA_TABLE), ...tableLines(above), ...tableLines(below)])
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
  })

  it('with its own right border missing, keeps the text box rather than reach for the neighbour', () => {
    const right: Table = { left: 246, top: 87, right: 380, bottom: 201, divider: 295, noBaseline: 100 }
    const before = alpha()
    const b = snapBlock(before, [...tableLines(ALPHA_TABLE, { right: true }), ...tableLines(right)])
    expect(b.snapped).toBe(false)
    expect(b.box).toEqual(before.box)
    expect(b.points).toEqual(before.points)
  })
})

describe('snapBlock — fallbacks', () => {
  it('a missing left border keeps the text box rather than take a line out in the drawing', () => {
    const before = alpha()
    const lines = [...tableLines(ALPHA_TABLE).filter((s) => !(s.axis === 'v' && s.at === T.left)), v(80, 60, 230)]
    const b = snapBlock(before, lines)
    expect(b.snapped).toBe(false)
    expect(b.box).toEqual(before.box)
  })

  it('a missing top border keeps the text box rather than take the bottom of the table above', () => {
    const before = alpha()
    const above: Table = { left: 97, top: -40, right: 240, bottom: 82, divider: 146, noBaseline: -20 }
    const lines = [...tableLines(ALPHA_TABLE).filter((s) => !(s.axis === 'h' && s.at === T.top)), ...tableLines(above)]
    const b = snapBlock(before, lines)
    expect(b.snapped).toBe(false)
    expect(b.box).toEqual(before.box)
  })

  it('a missing right border keeps the text box, marked not snapped', () => {
    const before = alpha()
    const b = snapBlock(before, tableLines(ALPHA_TABLE, { right: true }))
    expect(b.snapped).toBe(false)
    expect(b.box).toEqual(before.box)
  })

  it('no lines at all keeps the text box', () => {
    const before = alpha()
    expect(snapBlock(before, [])).toEqual({ ...before, snapped: false })
  })

  it('refuses a rectangle far bigger than the text (a frame round the whole sheet is not the table)', () => {
    const before = alpha()
    const frame = [h(10, 10, 900), h(700, 10, 900), v(10, 10, 700), v(900, 10, 700)]
    const b = snapBlock(before, frame)
    expect(b.snapped).toBe(false)
    expect(b.box).toEqual(before.box)
  })
})

describe('snapBlock — a frame drawn round the table', () => {
  it('stays on the table border, not a second rectangle a label-height outside it', () => {
    const d = 10 // 1h: a separate frame, not a thick border
    const frame = [
      h(T.top - d, T.left - d, T.right + d), h(T.bottom + d, T.left - d, T.right + d),
      v(T.left - d, T.top - d, T.bottom + d), v(T.right + d, T.top - d, T.bottom + d),
    ]
    const b = snapBlock(alpha(), [...tableLines(ALPHA_TABLE), ...frame])
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
  })
})

describe('snapBlock — a thick outer border (two parallel lines)', () => {
  it('takes the OUTER line on every side', () => {
    const d = 3 // 0.3h between the two strokes
    const inner = tableLines(ALPHA_TABLE)
    const outer = [
      h(T.top - d, T.left - d, T.right + d), h(T.bottom + d, T.left - d, T.right + d),
      v(T.left - d, T.top - d, T.bottom + d), v(T.right + d, T.top - d, T.bottom + d),
    ]
    const b = snapBlock(alpha(), [...inner, ...outer])
    expect(b.box).toEqual({ minX: T.left - d, minY: T.top - d, maxX: T.right + d, maxY: T.bottom + d })
  })
})

describe('snapBlock — tolerances scale with the label', () => {
  it('snaps a block printed at twice the size, border twice as far out', () => {
    const big = detectBlocks(blockItems({ x: 200, y: 200, values: ALPHA, h: 2 * H })).blocks[0]!
    // Text: left 200, NO: top 180, right 432 (values at 300, 11 chars × 12), CT: baseline 392.
    // Left border 2h (40 px) out: inside the 3h reach of THIS label, beyond 3 × a 10 px one.
    const t: Table = { left: 160, top: 174, right: 480, bottom: 402, divider: 292, noBaseline: 200, pitch: 2 * PITCH }
    const b = snapBlock(big, tableLines(t))
    expect(b.snapped).toBe(true)
    expect(b.box).toEqual({ minX: 160, minY: 174, maxX: 480, maxY: 402 })
  })
})

describe('snapBlock — a rotated sheet', () => {
  it('snaps to lines that reached image space through a /Rotate 90 viewport', async () => {
    const { segmentToImageSpace } = await import('./line-space')
    // Inverse of raster x = 2·userY, raster y = 2·userX: user (x, y) = (rasterY/2, rasterX/2).
    const rotated = tableLines(ALPHA_TABLE).map((s) => {
      const [x1, y1, x2, y2] = s.axis === 'h' ? [s.from, s.at, s.to, s.at] : [s.at, s.from, s.at, s.to]
      return segmentToImageSpace(y1 / 2, x1 / 2, y2 / 2, x2 / 2, [0, 2, 2, 0, 0, 0])!
    })
    const b = snapBlock(alpha(), rotated)
    expect(b.box).toEqual({ minX: 97, minY: 87, maxX: 240, maxY: 201 })
  })
})

describe('snapBlocks', () => {
  it('snaps each block to its own table and reports how many snapped', () => {
    const blocks = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA }),
      ...blockItems({ x: 400, y: 100, values: BRAVO }),
      ...blockItems({ x: 100, y: 400, values: DELTA_NO_TAG }),
    ]).blocks
    const lines = [
      ...tableLines(ALPHA_TABLE),
      ...tableLines({ left: 397, top: 87, right: 520, bottom: 201, divider: 446, noBaseline: 100 }),
      // DELTA has no table drawn round it.
    ]
    const out = snapBlocks(blocks, lines)
    expect(out.map((b) => [b.tag, b.snapped])).toEqual([['DB-71', true], ['DB-72', true], [null, false]])
    expect(out[1]!.box).toEqual({ minX: 397, minY: 87, maxX: 520, maxY: 201 })
  })
})
