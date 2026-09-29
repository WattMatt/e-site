import { describe, it, expect } from 'vitest'
import { loadHref, parseSubTab } from './subtabs'

describe('load sub-tabs', () => {
  it('defaults to meters and accepts known keys only', () => {
    expect(parseSubTab(undefined)).toBe('meters')
    expect(parseSubTab('profile')).toBe('profile')
    expect(parseSubTab(['checks'])).toBe('checks')
    expect(parseSubTab('nope')).toBe('meters')
  })
  it('builds hrefs', () => {
    expect(loadHref('p1', 'meters', { meter: 'm1' })).toBe('/projects/p1/solar/load?tab=meters&meter=m1')
  })
})
