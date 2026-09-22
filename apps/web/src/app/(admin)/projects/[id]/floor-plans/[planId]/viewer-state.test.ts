// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildViewerQuery, saveTargetFor, adoptSavedLayer, type ActiveLayer } from './viewer-state'

/**
 * Regression tests for the two defects PR #196 shipped.
 *
 * FIXTURE DISCIPLINE. Both tests are written so the OLD behaviour fails them:
 *
 *  - The old querystring builder was `next === 'view' ? '' : '?mode=' + next`.
 *    Any assertion that only checked `mode` would have passed against it. The
 *    assertions below are about `markup` SURVIVING, which is precisely what it
 *    dropped.
 *  - The old save target read `openMarkup?.id`, which is null for a layer
 *    created in this session. A test that saved ONCE would have passed against
 *    it, because the first save genuinely has no id. The defect only appears on
 *    the SECOND save, so every test below saves twice.
 *
 * Ask the fixture question — what would this have to look like to be able to
 * fail? — and the answer for a single-save test is "nothing". Hence the pairs.
 */

const LAYER: ActiveLayer = { id: 'aa-11', name: 'Cable pull route A', updatedAt: '2026-09-21T10:00:00.000Z' }

describe('buildViewerQuery — an open layer survives a mode change', () => {
  it('carries markup= through every mode', () => {
    expect(buildViewerQuery('markup', LAYER.id)).toBe('?mode=markup&markup=aa-11')
    expect(buildViewerQuery('rfi', LAYER.id)).toBe('?mode=rfi&markup=aa-11')
  })

  it('carries it into view mode too, where there is no mode param to hide behind', () => {
    // The old code returned '' for view, so this is the assertion that most
    // directly pins the defect: no mode key, but the layer still referenced.
    expect(buildViewerQuery('view', LAYER.id)).toBe('?markup=aa-11')
  })

  it('omits mode for view and emits nothing at all when no layer is open', () => {
    expect(buildViewerQuery('view', null)).toBe('')
    expect(buildViewerQuery('markup', null)).toBe('?mode=markup')
  })

  it('never emits ?mode=view — a bare URL and view must be the same place', () => {
    expect(buildViewerQuery('view', null)).not.toContain('mode')
    expect(buildViewerQuery('view', LAYER.id)).not.toContain('mode')
  })
})

describe('save target — the second save must UPDATE, not insert again', () => {
  it('sends no id on the first save of a fresh session', () => {
    expect(saveTargetFor(null)).toEqual({})
  })

  it('sends the adopted id and token on the second save', () => {
    // 1st save: fresh session, nothing to update.
    let active: ActiveLayer | null = null
    expect(saveTargetFor(active)).toEqual({})

    // The server created the row and returned it.
    active = adoptSavedLayer(active, { id: 'new-1', name: 'Route A', updatedAt: '2026-09-21T10:00:00.000Z' })

    // 2nd save: THIS is the assertion. Against the old code `active` was still
    // null here, the payload carried no markupId, the action INSERTed again and
    // the unique constraint refused it.
    expect(saveTargetFor(active)).toEqual({
      markupId: 'new-1',
      expectedUpdatedAt: '2026-09-21T10:00:00.000Z',
    })
  })

  it('advances the concurrency token on every save, not just the first', () => {
    let active = adoptSavedLayer(null, { id: 'x', name: 'A', updatedAt: '2026-09-21T10:00:00.000Z' })
    active = adoptSavedLayer(active, { id: 'x', name: 'A', updatedAt: '2026-09-21T10:05:00.000Z' })
    // A stale token would make the user's own next save collide with itself.
    expect(saveTargetFor(active).expectedUpdatedAt).toBe('2026-09-21T10:05:00.000Z')
  })

  it('follows a rename, so the Save button keeps naming the right layer', () => {
    let active = adoptSavedLayer(null, { id: 'x', name: 'Route A', updatedAt: 't1' })
    active = adoptSavedLayer(active, { id: 'x', name: 'Route A (revised)', updatedAt: 't2' })
    expect(active?.name).toBe('Route A (revised)')
  })

  it('keeps the current layer when a save returns no row, rather than detaching', () => {
    const active = adoptSavedLayer(null, { id: 'x', name: 'A', updatedAt: 't1' })
    expect(adoptSavedLayer(active, undefined)).toEqual(active)
  })
})

describe('the fixtures can actually fail', () => {
  it('a single-save test would pass against the old behaviour — so it is not the test', () => {
    // Demonstrates why every save test above saves TWICE: the first save is
    // genuinely id-less under both the old and the new code.
    expect(saveTargetFor(null)).toEqual({})
  })

  it('a mode-only assertion would pass against the old builder — so it is not the test', () => {
    const oldBuilder = (next: string) => (next === 'view' ? '' : `?mode=${next}`)
    expect(oldBuilder('markup')).toContain('mode=markup')
    expect(buildViewerQuery('markup', LAYER.id)).toContain('mode=markup')
    // ...and here is where they part company.
    expect(oldBuilder('markup')).not.toContain('markup=aa-11')
    expect(buildViewerQuery('markup', LAYER.id)).toContain('markup=aa-11')
  })
})
