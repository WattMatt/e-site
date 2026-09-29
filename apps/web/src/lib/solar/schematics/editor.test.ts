import { describe, it, expect } from 'vitest'
import {
  addLine, anchorOf, historyCommit, historyInit, historyRedo, historyUndo, includeToggleActive, linePoints, moveCard, placeCard, removeCard,
  removeLine, resizeCard, setWaypoints, snapCard, toSavePayload, type SchematicDoc,
} from './editor'

const empty: SchematicDoc = { cards: [], lines: [] }
const withTwo = (): SchematicDoc => ({
  cards: [
    { meterId: 'A', x: 0, y: 0, w: 180, h: 64, colour: null },
    { meterId: 'B', x: 400, y: 0, w: 180, h: 64, colour: null },
  ],
  lines: [],
})

describe('schematic editor', () => {
  it('places a card centred on the click, once per meter', () => {
    const r = placeCard(empty, 'A', { x: 100, y: 100 })
    expect(r.ok && r.doc.cards[0]).toEqual({ meterId: 'A', x: 10, y: 68, w: 180, h: 64, colour: null })
    const again = placeCard((r as { doc: SchematicDoc }).doc, 'A', { x: 0, y: 0 })
    expect(again).toEqual({ ok: false, reason: 'That meter is already on this schematic.' })
  })
  it('moves and resizes with limits', () => {
    const d = resizeCard(moveCard(withTwo(), 'A', 5, 6), 'A', 10, 99999)
    expect(d.cards[0]).toMatchObject({ x: 5, y: 6, w: 60, h: 5000 })
  })
  it('connects placed meters, refuses self, duplicates and loops (including other schematics’ lines)', () => {
    const d = withTwo()
    const r = addLine(d, { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, [])
    expect(r.ok).toBe(true)
    const d2 = (r as { doc: SchematicDoc }).doc
    expect(addLine(d2, { fromMeterId: 'A', toMeterId: 'A', waypoints: [], lineType: 'supply' }, [])).toMatchObject({ ok: false })
    expect(addLine(d2, { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, [])).toEqual({ ok: false, reason: 'Those meters are already connected.' })
    expect(addLine(d2, { fromMeterId: 'B', toMeterId: 'A', waypoints: [], lineType: 'supply' }, [])).toEqual({ ok: false, reason: 'That connection would make a loop in the supply hierarchy.' })
    expect(addLine(d, { fromMeterId: 'B', toMeterId: 'A', waypoints: [], lineType: 'supply' }, [{ fromMeterId: 'A', toMeterId: 'B' }])).toMatchObject({ ok: false })
    expect(addLine(d2, { fromMeterId: 'B', toMeterId: 'A', waypoints: [], lineType: 'check' }, []).ok).toBe(true)
    expect(addLine(d, { fromMeterId: 'A', toMeterId: 'Z', waypoints: [], lineType: 'supply' }, [])).toEqual({ ok: false, reason: 'Both meters must be placed first.' })
  })
  it('deleting a card deletes its lines', () => {
    const d = (addLine(withTwo(), { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, []) as { doc: SchematicDoc }).doc
    expect(removeCard(d, 'B')).toEqual({ cards: [d.cards[0]], lines: [] })
    expect(removeLine(d, d.lines[0].key).lines).toEqual([])
  })
  it('anchors follow the card (live), waypoints in between', () => {
    const d0 = (addLine(withTwo(), { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, []) as { doc: SchematicDoc }).doc
    const d = setWaypoints(d0, d0.lines[0].key, [300, 200])
    expect(anchorOf(d.cards[0], { x: 1000, y: 32 })).toEqual({ x: 180, y: 32 })
    // A faces (300,200) with its bottom side, B faces it with its bottom side too (steep angle).
    expect(linePoints(d.lines[0], d)).toEqual([90, 64, 300, 200, 490, 64])
    const moved = moveCard(d, 'B', 400, 500)
    expect(linePoints(moved.lines[0], moved)?.slice(-2)).toEqual([490, 500])
    expect(() => setWaypoints(d, d.lines[0].key, [1, 2, 3])).toThrow(RangeError)
  })
  it('snaps a card to another card’s left edge or centre within the tolerance', () => {
    const s = snapCard({ meterId: 'X', x: 404, y: 203, w: 180, h: 64, colour: null }, withTwo().cards, 8)
    expect(s.x).toBe(400)
    expect(s.guides).toContainEqual({ axis: 'x', at: 400 })
  })
  it('history: commit, undo, redo; a new commit clears the future', () => {
    let h = historyInit(1)
    h = historyCommit(h, 2)
    h = historyCommit(h, 3)
    h = historyUndo(h)
    expect(h.present).toBe(2)
    h = historyRedo(h)
    expect(h.present).toBe(3)
    h = historyCommit(historyUndo(h), 9)
    expect(h.future).toEqual([])
  })
  it('save payload drops local keys', () => {
    const d = (addLine(withTwo(), { fromMeterId: 'A', toMeterId: 'B', waypoints: [1, 2], lineType: 'supply' }, []) as { doc: SchematicDoc }).doc
    expect(toSavePayload(d).lines).toEqual([{ fromMeterId: 'A', toMeterId: 'B', waypoints: [1, 2], lineType: 'supply' }])
    expect(toSavePayload(d).cards[0]).toEqual({ meterId: 'A', x: 0, y: 0, w: 180, h: 64, colour: null })
  })
})

describe('includeToggleActive', () => {
  it('the include circle toggles only with the Select tool on an editable canvas — in Connect / Place a press on it is a press on the card', () => {
    expect(includeToggleActive(true, 'select')).toBe(true)
    expect(includeToggleActive(true, 'connect')).toBe(false)
    expect(includeToggleActive(true, 'place')).toBe(false)
    expect(includeToggleActive(false, 'select')).toBe(false)
  })
})
