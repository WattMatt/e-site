import { describe, it, expect } from 'vitest'
import { rectToPoints, type ImageTextItem, type LineSegment, type MatchableNode } from '@esite/shared/status-plans'
import {
  initialRealignState,
  realignReducer,
  realignProposals,
  scanForRealign,
  type RealignScan,
  type RealignState,
} from './realign-state'
import type { CanvasShape } from './types'

/*
 * Invented geometry (the snap-blocks fixture): ALPHA's text at x=100, NO:
 * baseline 100; its table drawn 97..240 × 87..201.
 */
const T = { left: 97, top: 87, right: 240, bottom: 201, divider: 146 }
const hl = (at: number, from: number, to: number): LineSegment => ({ axis: 'h', at, from, to })
const vl = (at: number, from: number, to: number): LineSegment => ({ axis: 'v', at, from, to })
const LINES: LineSegment[] = [
  hl(T.top, T.left, T.right), hl(T.bottom, T.left, T.right), vl(T.left, T.top, T.bottom), vl(T.divider, T.top, T.bottom), vl(T.right, T.top, T.bottom),
  ...Array.from({ length: 6 }, (_, r) => hl(100 + r * 16 + 5, T.left, T.right)),
]
// Text height 10, rows 16 apart, values 50 right of the labels, 6 px a character.
const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:']
const VALUES = ['DB-71', 'ALPHA STORE', '412.50m2', '250A TP', '4C 95mm2 CU', 'ZX-0001', '250/5A']
const t = (str: string, x: number, baseline: number): ImageTextItem =>
  ({ str, x, baseline, top: baseline - 10, width: str.length * 6, height: 10 })
const ITEMS = LABELS.flatMap((l, row) => [t(l, 100, 100 + row * 16), t(VALUES[row]!, 150, 100 + row * 16)])
const NODES: MatchableNode[] = [{ id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' }]

function shape(id: string, points: number[], nodeId: string | null = 'n-71', updatedAt = `ts-${id}`): CanvasShape {
  return { id, sheetId: 'sheet', shape: 'rect', points, nodeId, areaType: null, detectedTag: null, source: 'manual', updatedAt }
}
const HAND = shape('a', rectToPoints(100, 92, 225, 205))
const BORDER = rectToPoints(T.left, T.top, T.right, T.bottom)

describe('scanForRealign', () => {
  it('proposes the hand-drawn block onto the table border', () => {
    const r = scanForRealign({ items: ITEMS, rawItemCount: ITEMS.length, lines: LINES }, [HAND], NODES)
    expect(r.kind).toBe('plan')
    if (r.kind !== 'plan') return
    const res = r.plan.results[0]!
    expect(res.kind).toBe('move')
    if (res.kind === 'move') expect(res.to).toEqual(BORDER)
  })

  it('a drawing without line work says so', () => {
    expect(scanForRealign({ items: ITEMS, rawItemCount: ITEMS.length, lines: [] }, [HAND], NODES)).toEqual({ kind: 'no_lines' })
  })

  it('line work but no table round any block', () => {
    expect(scanForRealign({ items: ITEMS, rawItemCount: ITEMS.length, lines: [hl(500, 0, 900)] }, [HAND], NODES)).toEqual({ kind: 'no_tables' })
    expect(scanForRealign({ items: [], rawItemCount: 0, lines: LINES }, [HAND], NODES)).toEqual({ kind: 'no_tables' })
  })
})

function scanned(s: RealignState, scan: RealignScan, run = s.run): RealignState {
  return realignReducer(s, { type: 'scanned', run, scan })
}
const planFor = (shapes: CanvasShape[]) => scanForRealign({ items: ITEMS, rawItemCount: ITEMS.length, lines: LINES }, shapes, NODES)

describe('realignReducer', () => {
  it('scan → preview → apply → applied → undo → idle', () => {
    let s = realignReducer(initialRealignState, { type: 'scan' })
    expect(s.phase).toBe('scanning')
    s = scanned(s, planFor([HAND]))
    expect(s.phase).toBe('preview')
    if (s.phase !== 'preview') return
    expect(s.moves).toEqual([{ shapeId: 'a', expectedUpdatedAt: 'ts-a', points: BORDER }])
    expect(realignProposals(s)).toEqual([BORDER])

    s = realignReducer(s, { type: 'apply' })
    expect(s.phase).toBe('applying')
    s = realignReducer(s, { type: 'applied', shapes: [{ ...HAND, points: BORDER, updatedAt: 'ts-new' }] })
    expect(s).toMatchObject({ phase: 'applied', count: 1 })
    // Undo: the same call with the PREVIOUS points and the NEW updated_at.
    if (s.phase !== 'applied') return
    expect(s.undo).toEqual([{ shapeId: 'a', expectedUpdatedAt: 'ts-new', points: HAND.points }])
    expect(realignProposals(s)).toEqual([])

    s = realignReducer(s, { type: 'undo' })
    expect(s.phase).toBe('undoing')
    s = realignReducer(s, { type: 'undone' })
    expect(s).toMatchObject({ phase: 'idle', message: 'Put 1 block back where it was.' })
  })

  it('a scan answer for an older run (or after a cancel) is dropped', () => {
    let s = realignReducer(initialRealignState, { type: 'scan' })
    const first = s.run
    s = realignReducer(realignReducer(s, { type: 'cancel' }), { type: 'scan' })
    expect(s.run).toBe(first + 1)
    expect(scanned(s, planFor([HAND]), first)).toBe(s)
    const cancelled = realignReducer(s, { type: 'cancel' })
    expect(cancelled.phase).toBe('idle')
    expect(scanned(cancelled, planFor([HAND]), s.run)).toBe(cancelled)
  })

  it('no line work and no tables end in a sentence', () => {
    const s = realignReducer(initialRealignState, { type: 'scan' })
    expect(scanned(s, { kind: 'no_lines' })).toMatchObject({ phase: 'idle', message: 'This drawing has no table lines to align to.' })
    expect(scanned(s, { kind: 'no_tables' })).toMatchObject({ phase: 'idle', message: 'No table borders were found round any DB block on this drawing.' })
    expect(scanned(s, { kind: 'error', message: 'Could not read it.' })).toMatchObject({ phase: 'idle', message: 'Could not read it.' })
  })

  it('apply with nothing to move does nothing', () => {
    let s = realignReducer(initialRealignState, { type: 'scan' })
    s = scanned(s, planFor([shape('a', BORDER)]))
    expect(s.phase).toBe('preview')
    expect(realignReducer(s, { type: 'apply' })).toBe(s)
  })

  it('a refused apply drops the preview (its plan is stale) and shows the sentence', () => {
    let s = realignReducer(initialRealignState, { type: 'scan' })
    s = scanned(s, planFor([HAND]))
    s = realignReducer(s, { type: 'apply' })
    s = realignReducer(s, { type: 'applyFailed', error: 'Someone changed 1 of these blocks — reload and try again. Nothing was moved.' })
    expect(s).toMatchObject({ phase: 'idle', message: 'Someone changed 1 of these blocks — reload and try again. Nothing was moved.' })
  })

  it('a refused undo keeps the applied state with the sentence', () => {
    let s = realignReducer(initialRealignState, { type: 'scan' })
    s = scanned(s, planFor([HAND]))
    s = realignReducer(realignReducer(s, { type: 'apply' }), { type: 'applied', shapes: [{ ...HAND, points: BORDER, updatedAt: 'ts-new' }] })
    s = realignReducer(realignReducer(s, { type: 'undo' }), { type: 'undoFailed', error: 'No.' })
    expect(s).toMatchObject({ phase: 'applied', count: 1, message: 'No.' })
  })

  it('cannot start a scan while a write is in flight', () => {
    let s = realignReducer(initialRealignState, { type: 'scan' })
    s = realignReducer(scanned(s, planFor([HAND])), { type: 'apply' })
    expect(realignReducer(s, { type: 'scan' })).toBe(s)
    expect(realignReducer(s, { type: 'cancel' })).toBe(s)
  })
})
