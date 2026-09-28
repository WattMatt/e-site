import { describe, it, expect } from 'vitest'
import { rebuildMessage } from './use-rebuild'

describe('rebuildMessage', () => {
  it('describes each stage', () => {
    expect(rebuildMessage({ type: 'progress', stage: 'reading', done: 3, total: 7 })).toBe('Reading meter data… 3 of 7 channels')
    expect(rebuildMessage({ type: 'progress', stage: 'building', done: 0, total: 1 })).toBe('Building the site profile…')
    expect(rebuildMessage({ type: 'progress', stage: 'saving', done: 0, total: 1 })).toBe('Saving…')
    expect(rebuildMessage({ type: 'done', siteLoadId: 'x', basis: 'S2', referenceYear: 2025, checks: 4 })).toBe('Site profile rebuilt — basis S2, reference year 2025, 4 checks to review.')
  })
})
