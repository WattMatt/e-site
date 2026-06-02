import { describe, it, expect } from 'vitest'
import { resolveHandoverCategory, buildHandoverDrawingName } from './category-map'

describe('resolveHandoverCategory', () => {
  it('maps built-in equipment kinds', () => {
    expect(resolveHandoverCategory({ kind: 'main_board' })).toBe('main_boards')
    expect(resolveHandoverCategory({ kind: 'common_area_board' })).toBe('main_boards')
    expect(resolveHandoverCategory({ kind: 'tenant_db' })).toBe('main_boards')
    expect(resolveHandoverCategory({ kind: 'rmu' })).toBe('switchgear')
    expect(resolveHandoverCategory({ kind: 'mini_sub' })).toBe('transformers')
    expect(resolveHandoverCategory({ kind: 'generator' })).toBe('generators')
  })

  it('maps built-in scope keys', () => {
    expect(resolveHandoverCategory({ scopeKey: 'db' })).toBe('main_boards')
    expect(resolveHandoverCategory({ scopeKey: 'lighting' })).toBe('lighting')
  })

  it('returns null for unmapped types (caller must prompt)', () => {
    expect(resolveHandoverCategory({ kind: 'custom' })).toBeNull()
    expect(resolveHandoverCategory({ scopeKey: 'small_power' })).toBeNull()
    expect(resolveHandoverCategory({})).toBeNull()
  })

  it('scope override beats the scope default', () => {
    expect(resolveHandoverCategory({ scopeKey: 'db', scopeTypeOverride: 'metering' })).toBe('metering')
  })

  it('node override beats the equipment default', () => {
    expect(resolveHandoverCategory({ kind: 'generator', nodeOverride: 'commissioning_docs' })).toBe('commissioning_docs')
  })

  it('a scope order ignores the node override (avoids mis-routing mixed nodes)', () => {
    expect(resolveHandoverCategory({ scopeKey: 'db', nodeOverride: 'lighting' })).toBe('main_boards')
  })

  it('ignores invalid override strings', () => {
    expect(resolveHandoverCategory({ kind: 'generator', nodeOverride: 'not_a_category' })).toBe('generators')
    expect(resolveHandoverCategory({ kind: 'custom', nodeOverride: '' })).toBeNull()
  })
})

describe('buildHandoverDrawingName', () => {
  it('prefixes the item label', () => {
    expect(buildHandoverDrawingName('Main Board A', 'ga.pdf')).toBe('Main Board A — ga.pdf')
  })
  it('does not double-prefix', () => {
    expect(buildHandoverDrawingName('Main Board A', 'Main Board A — ga.pdf')).toBe('Main Board A — ga.pdf')
  })
  it('falls back to the file name when the label is blank', () => {
    expect(buildHandoverDrawingName('   ', 'ga.pdf')).toBe('ga.pdf')
  })
})
