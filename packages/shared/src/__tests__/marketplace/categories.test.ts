import { describe, it, expect } from 'vitest'
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_VALUES,
  isMarketplaceCategory,
} from '../../marketplace/categories'

describe('marketplace categories', () => {
  it('exposes the 7 canonical categories in order', () => {
    expect(MARKETPLACE_CATEGORY_VALUES).toEqual([
      'electrical', 'mechanical', 'civil', 'safety', 'tools', 'materials', 'general',
    ])
  })
  it('includes tools and materials (the catalogue-only values)', () => {
    expect(MARKETPLACE_CATEGORY_VALUES).toContain('tools')
    expect(MARKETPLACE_CATEGORY_VALUES).toContain('materials')
  })
  it('every category has a label and an icon', () => {
    for (const c of MARKETPLACE_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.icon.length).toBeGreaterThan(0)
    }
  })
  it('validates membership', () => {
    expect(isMarketplaceCategory('electrical')).toBe(true)
    expect(isMarketplaceCategory('plumbing')).toBe(false)
  })
})
