import { describe, it, expect } from 'vitest'
import { applySaveResult, draftOffer, exportBlockedBy, pruneSelection, restoreDraft, uniqueCopyName, visibleObjects, LAYERS } from './layout-editor-state'
import type { LayoutObject } from '@esite/shared'

const inv = (id: string, x: number, ppm: number | null = null): LayoutObject =>
  ({ id, kind: 'inverter', pixelsPerMeter: ppm, geometry: { x, y: 0 }, props: { name: id, inverter: {} } }) as unknown as LayoutObject

describe('applySaveResult (review fix: edits made while a save is in flight survive)', () => {
  it('stamps the scale onto the CURRENT objects and records what was actually sent as saved', () => {
    const sent = [inv('a', 1)]
    const present = [inv('a', 1), inv('b', 2)] // b was added during the round trip
    const r = applySaveResult(sent, present, { a: 50 })
    expect(r.present.map((o) => [o.id, o.pixelsPerMeter])).toEqual([['a', 50], ['b', null]])
    expect(r.saved.map((o) => [o.id, o.pixelsPerMeter])).toEqual([['a', 50]])
  })
  it('an object moved during the round trip keeps its new position', () => {
    const r = applySaveResult([inv('a', 1)], [inv('a', 9)], { a: 50 })
    expect((r.present[0]!.geometry as { x: number }).x).toBe(9)
    expect((r.saved[0]!.geometry as { x: number }).x).toBe(1)
  })
})

describe('draftOffer (review fix: a draft is offered back after a stale save)', () => {
  const server = [inv('a', 1)]
  it('no draft, or a draft equal to the server copy → nothing to offer', () => {
    expect(draftOffer(null, 'T1', server)).toBeNull()
    expect(draftOffer({ objects: server, basedOn: 'T1', savedAt: 'S' }, 'T1', server)).toBeNull()
  })
  it('a draft of THIS version is offered as current', () => {
    expect(draftOffer({ objects: [inv('a', 2)], basedOn: 'T1', savedAt: 'S' }, 'T1', server)).toMatchObject({ stale: false })
  })
  it('a draft of an OLDER version is still offered, flagged stale', () => {
    expect(draftOffer({ objects: [inv('a', 2)], basedOn: 'T0', savedAt: 'S' }, 'T1', server)).toMatchObject({ stale: true })
  })
})

describe('layers', () => {
  const objs = [
    { id: 'r', kind: 'roof' }, { id: 'o', kind: 'obstruction' }, { id: 'a', kind: 'array' }, { id: 'm', kind: 'module_block' },
    { id: 's', kind: 'string' }, { id: 'i', kind: 'inverter' }, { id: 'e', kind: 'equipment' },
  ] as unknown as LayoutObject[]
  it('every object kind drawn on the canvas belongs to a layer', () => {
    expect(LAYERS.map((l) => l.key)).toEqual(['roofs', 'obstructions', 'arrays', 'strings', 'equipment'])
    expect(visibleObjects(objs, new Set()).length).toBe(objs.length)
  })
  it('hiding a layer hides its kinds only', () => {
    expect(visibleObjects(objs, new Set(['arrays'])).map((o) => o.id)).toEqual(['r', 'o', 's', 'i', 'e'])
    expect(visibleObjects(objs, new Set(['equipment', 'strings'])).map((o) => o.id)).toEqual(['r', 'o', 'a', 'm'])
  })
})

describe('uniqueCopyName (review fix: a second Duplicate does not collide)', () => {
  it('first copy, then numbered copies', () => {
    expect(uniqueCopyName('A', ['A'])).toBe('A (copy)')
    expect(uniqueCopyName('A', ['A', 'A (copy)'])).toBe('A (copy 2)')
    expect(uniqueCopyName('A', ['A', 'a (COPY)', 'A (copy 2)'])).toBe('A (copy 3)')
  })
})

describe('exportBlockedBy (re-review fix: an export never silently omits a hidden layer)', () => {
  it('names the hidden layers', () => {
    expect(exportBlockedBy(new Set())).toBeNull()
    expect(exportBlockedBy(new Set(['arrays', 'strings']))).toBe('Show every layer before exporting the sheet (hidden: Arrays, Strings).')
  })
})

describe('pruneSelection (re-review fix: hidden objects cannot stay selected)', () => {
  it('drops ids and modules that are no longer visible', () => {
    const visible = [inv('a', 1)]
    expect(pruneSelection({ ids: ['a', 'b'], modules: [{ arrayId: 'z', index: 0 }] }, visible)).toEqual({ ids: ['a'], modules: [] })
  })
})

describe('restoreDraft (third re-review: replay only onto an unchanged layout)', () => {
  const q = (x: number) => [x, 0, x + 10, 0, x + 10, 20, x, 20]
  const arrX = (xs: number[]): LayoutObject => ({ id: 'X', kind: 'array', pixelsPerMeter: 10, geometry: { modules: xs.map(q) }, props: {} }) as unknown as LayoutObject
  const I = inv('I', 0)
  it('a draft of the CURRENT layout replays its edits', () => {
    const base = [inv('a', 1)]
    const r = restoreDraft({ objects: [inv('a', 5), inv('b', 2)], base, basedOn: 'T0', savedAt: 's' }, [inv('a', 1)])
    expect(r.ok && r.objects.map((o) => [o.id, (o.geometry as { x: number }).x])).toEqual([['a', 5], ['b', 2]])
  })
  it('refuses when someone else changed the layout since the draft — never a partial, silent merge', () => {
    const base = [inv('a', 1)]
    const added = restoreDraft({ objects: [inv('a', 5)], base, basedOn: 'T0', savedAt: 's' }, [inv('a', 1), inv('b', 2)])
    expect(added).toEqual({ ok: false, error: 'Someone else changed this layout after these edits were made, so they cannot be merged safely. Discard them, or note them and redo them on the current layout.' })
    const deleted = restoreDraft({ objects: [inv('a', 5)], base, basedOn: 'T0', savedAt: 's' }, [])
    expect(deleted.ok).toBe(false)
  })
  it('the renumbering case: a colleague removed the FIRST module of X; the user’s string on X is not replayed onto shifted indices', () => {
    const base = [arrX([0, 10, 20, 30]), I]
    const S = { id: 'S', kind: 'string', pixelsPerMeter: null, geometry: {}, props: { inverterId: 'I', mppt: 1, modules: [{ arrayId: 'X', index: 1 }] } } as unknown as LayoutObject
    const r = restoreDraft({ objects: [arrX([0, 10, 20, 30]), I, S], base, basedOn: 'T0', savedAt: 's' }, [arrX([10, 20, 30]), I])
    expect(r.ok).toBe(false)
  })
  it('a legacy draft with no base is replayed only when it was made on this version', () => {
    expect(restoreDraft({ objects: [inv('a', 5)], basedOn: 'T0', savedAt: 's' }, [inv('a', 1)], 'T0').ok).toBe(true)
    expect(restoreDraft({ objects: [inv('a', 5)], basedOn: 'T0', savedAt: 's' }, [inv('a', 1)], 'T1').ok).toBe(false)
  })
})
