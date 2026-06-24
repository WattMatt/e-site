import { describe, it, expect } from 'vitest'
import { computeTenantElectrical } from './tenant-electrical'

const REV = 'rev-1'

describe('computeTenantElectrical', () => {
  it('derives values for a single-incomer tenant', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 60 }],
      new Map([['s1', [{ derated_current_rating_a: 90, cores: '3' }]]]),
      REV,
    )
    expect(out.get('n1')).toEqual({
      breakerA: 63,
      poleConfig: 'TP',
      loadA: 60,
      capacityA: 90,
      underProtected: false,
      multipleFeeds: false,
      sourceRevisionId: REV,
    })
  })

  it('picks the highest-load feed and flags multiple feeds', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [
        { id: 's1', to_node_id: 'n1', design_load_a: 40 },
        { id: 's2', to_node_id: 'n1', design_load_a: 100 },
      ],
      new Map([
        ['s1', [{ derated_current_rating_a: 50, cores: '3' }]],
        ['s2', [{ derated_current_rating_a: 60, cores: '4' }]],
      ]),
      REV,
    )
    const r = out.get('n1')!
    expect(r.loadA).toBe(100)
    expect(r.breakerA).toBe(100)
    expect(r.poleConfig).toBe('TP')
    expect(r.multipleFeeds).toBe(true)
  })

  it('sums parallel cable capacity', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 150 }],
      new Map([['s1', [
        { derated_current_rating_a: 95, cores: '4' },
        { derated_current_rating_a: 95, cores: '4' },
      ]]]),
      REV,
    )
    expect(out.get('n1')!.capacityA).toBe(190)
  })

  it('omits tenants with no incoming supply', () => {
    const out = computeTenantElectrical(
      ['n1', 'n2'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 60 }],
      new Map([['s1', []]]),
      REV,
    )
    expect(out.has('n2')).toBe(false)
  })

  it('treats cables with no computed rating as unknown capacity (not zero)', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 800 }],
      new Map([['s1', [{ derated_current_rating_a: null, cores: '4' }]]]),
      REV,
    )
    const r = out.get('n1')!
    expect(r.capacityA).toBeNull()
    expect(r.underProtected).toBe(false)
    expect(r.breakerA).toBe(800)
    expect(r.poleConfig).toBe('TP')
  })

  it('reports null capacity when the incomer has no cables', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 60 }],
      new Map([['s1', []]]),
      REV,
    )
    expect(out.get('n1')!.capacityA).toBeNull()
  })
})
