import { describe, it, expect } from 'vitest'
import {
  ANNOT_FLAG, annotationDrawn, appearanceMatrix, normaliseRect, pickAppearance, transformBox, type Mat,
} from './annotation-appearance'

const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

describe('annotationDrawn (mirrors pdf.js 5.7 default display)', () => {
  it('draws ordinary markups (Square, Ink, FreeText, Stamp…)', () => {
    for (const t of ['Square', 'Circle', 'Ink', 'FreeText', 'Stamp', 'Polygon', 'PolyLine', 'Line', null]) {
      expect(annotationDrawn(t, 4), String(t)).toBe(true)
    }
  })
  it('never draws Popup or Link', () => {
    expect(annotationDrawn('Popup', 4)).toBe(false)
    expect(annotationDrawn('Link', 0)).toBe(false)
  })
  it('skips Hidden (bit 2) and NoView (bit 6) for everything, Widgets included', () => {
    expect(annotationDrawn('Square', ANNOT_FLAG.hidden)).toBe(false)
    expect(annotationDrawn('Square', ANNOT_FLAG.noView | 4)).toBe(false)
    expect(annotationDrawn('Widget', ANNOT_FLAG.hidden)).toBe(false)
    expect(annotationDrawn('Widget', ANNOT_FLAG.noView)).toBe(false)
  })
  it('Invisible (bit 1) hides a markup but not a Widget, exactly as pdf.js does', () => {
    expect(annotationDrawn('Square', ANNOT_FLAG.invisible)).toBe(false)
    expect(annotationDrawn('Widget', ANNOT_FLAG.invisible)).toBe(true)
  })
})

describe('pickAppearance', () => {
  const states = new Map([['On', 'ON'], ['Off', 'OFF']])
  it('a single stream is used whatever /AS says', () => {
    expect(pickAppearance({ kind: 'stream', stream: 'S' }, null)).toBe('S')
    expect(pickAppearance({ kind: 'stream', stream: 'S' }, 'Off')).toBe('S')
  })
  it('a dictionary of states picks /AS; a missing or unknown /AS draws nothing', () => {
    expect(pickAppearance({ kind: 'states', states }, 'Off')).toBe('OFF')
    expect(pickAppearance({ kind: 'states', states }, null)).toBeNull()
    expect(pickAppearance({ kind: 'states', states }, 'Maybe')).toBeNull()
    expect(pickAppearance(null, 'On')).toBeNull()
  })
})

describe('transformBox and normaliseRect', () => {
  it('normalises a reversed rectangle', () => {
    expect(normaliseRect([200, 240, 100, 200])).toEqual([100, 200, 200, 240])
  })
  it('bounds the four transformed corners', () => {
    expect(transformBox([0, 0, 50, 20], [0, 1, -1, 0, 20, 0])).toEqual([0, 0, 20, 50])
  })
})

describe('appearanceMatrix (PDF 32000 §12.5.5)', () => {
  it('identity Matrix: scale the BBox onto the Rect', () => {
    expect(appearanceMatrix([100, 200, 200, 240], [0, 0, 50, 20], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 100, 200])
  })
  it('a BBox that does not start at the origin', () => {
    expect(appearanceMatrix([0, 0, 100, 40], [10, 10, 60, 30], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, -20, -20])
  })
  it('a rotated Matrix: the transformed BBox corners land on the Rect corners', () => {
    const M: Mat = [0, 1, -1, 0, 20, 0]
    const A = appearanceMatrix([100, 200, 140, 300], [0, 0, 50, 20], M)
    const [x0, y0] = apply(A, ...apply(M, 0, 20))
    const [x1, y1] = apply(A, ...apply(M, 50, 0))
    expect([x0, y0, x1, y1].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([100, 200, 140, 300])
  })
  it('a reversed Rect is normalised first', () => {
    expect(appearanceMatrix([200, 240, 100, 200], [0, 0, 50, 20], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 100, 200])
  })
  it('a degenerate BBox is placed at the Rect\'s corner unscaled (as pdf.js does)', () => {
    expect(appearanceMatrix([100, 200, 200, 240], [0, 0, 0, 20], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, 100, 200])
  })
})
