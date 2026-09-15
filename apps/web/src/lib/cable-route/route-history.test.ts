import { describe, it, expect } from 'vitest'
import { emptyHistory, pushHistory, undoHistory, redoHistory, snapshotsEqual, type RouteSnapshot } from './route-history'
import { snapRouteVertex } from './snap'

/**
 * Undo/redo for route mode is a history of SNAPSHOTS, not of operations. A
 * snapshot is everything the measurer can see change: the saved legs (as the
 * server holds them), the pending leg, and the polyline being clicked out.
 * Because a save replaces the whole segment list, undoing a persisted edit is
 * "persist the previous snapshot's legs" — no inverse operation to get wrong.
 *
 * Fixtures are deliberately asymmetric (different point counts per state) so a
 * bug that returns the wrong snapshot cannot coincide with the right one.
 */

const S0: RouteSnapshot = { legs: [], pending: null, draft: [] }
const S1: RouteSnapshot = { legs: [], pending: null, draft: [0, 0, 10, 0] }
const S2: RouteSnapshot = { legs: [{ floorPlanId: 'p', pageIndex: 1, points: [0, 0, 10, 0, 10, 10] }], pending: null, draft: [] }
const S3: RouteSnapshot = { legs: [{ floorPlanId: 'p', pageIndex: 1, points: [0, 0, 12, 0, 10, 10] }], pending: null, draft: [] }

describe('route history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = emptyHistory(S0)
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
    expect(h.present).toEqual(S0)
  })

  it('pushing a new state makes the old one undoable and clears redo', () => {
    let h = pushHistory(emptyHistory(S0), S1)
    h = pushHistory(h, S2)
    expect(h.canUndo).toBe(true)
    const u = undoHistory(h)
    expect(u.present).toEqual(S1)
    expect(u.canRedo).toBe(true)
    // A new push after an undo discards the redo branch, as every editor does.
    const p = pushHistory(u, S3)
    expect(p.canRedo).toBe(false)
    expect(p.present).toEqual(S3)
  })

  it('undo then redo returns exactly the state that was undone', () => {
    const h = pushHistory(pushHistory(emptyHistory(S0), S1), S2)
    expect(redoHistory(undoHistory(h)).present).toEqual(S2)
  })

  it('undo at the beginning and redo at the end are no-ops, not crashes', () => {
    const h = emptyHistory(S0)
    expect(undoHistory(h).present).toEqual(S0)
    expect(redoHistory(h).present).toEqual(S0)
  })

  it('does not record a push that changes nothing', () => {
    const h = pushHistory(emptyHistory(S2), { legs: [{ ...S2.legs[0], points: [...S2.legs[0].points] }], pending: null, draft: [] })
    expect(h.canUndo).toBe(false)
  })

  it('caps the past at the limit so a long session cannot grow without bound', () => {
    let h = emptyHistory(S0)
    for (let i = 0; i < 150; i++) h = pushHistory(h, { legs: [], pending: null, draft: [i, i] })
    expect(h.past.length).toBeLessThanOrEqual(100)
    expect(h.present.draft).toEqual([149, 149])
  })

  it('compares snapshots by value, ignoring leg ids', () => {
    expect(snapshotsEqual(S2, { ...S2, legs: [{ ...S2.legs[0], id: 'x' } as any] })).toBe(true)
    expect(snapshotsEqual(S2, S3)).toBe(false)
  })
})

describe('snapRouteVertex', () => {
  const endpoints = [[100, 100], [500, 500]] as Array<[number, number]>

  it('snaps the FIRST vertex of a leg to a nearby endpoint of a saved leg, so legs join', () => {
    expect(snapRouteVertex([104, 97], null, endpoints, 12, false)).toEqual({ point: [100, 100], snappedTo: 'endpoint' })
  })

  it('does not snap the first vertex to an endpoint outside the tolerance', () => {
    expect(snapRouteVertex([130, 100], null, endpoints, 12, false)).toEqual({ point: [130, 100], snappedTo: null })
  })

  it('with Shift, constrains a later vertex to 0/45/90 degrees from the previous one', () => {
    // 100 along, 8 up: nearest of the eight directions is horizontal.
    const r = snapRouteVertex([100, 8], [0, 0], [], 12, true)
    expect(r.snappedTo).toBe('angle')
    expect(r.point[1]).toBeCloseTo(0, 6)
    expect(r.point[0]).toBeCloseTo(Math.hypot(100, 8), 6)
  })

  it('never angle-snaps the first vertex (there is no previous one) and never endpoint-snaps a later vertex', () => {
    expect(snapRouteVertex([100, 8], null, [], 12, true).snappedTo).toBe(null)
    expect(snapRouteVertex([104, 97], [0, 0], endpoints, 12, false).snappedTo).toBe(null)
  })
})
