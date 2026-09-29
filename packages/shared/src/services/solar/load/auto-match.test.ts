import { describe, it, expect } from 'vitest'
import { autoMatchMeters, normShop, type MatchMeter, type MatchTenant } from './auto-match'

const m = (meterId: string, over: Partial<MatchMeter> = {}): MatchMeter => ({ meterId, label: meterId, kind: 'tenant', serials: [], shopNo: null, ...over })
const tenants: MatchTenant[] = [
  { nodeId: 'n50', shopNumber: '050', name: 'Checkers' },
  { nodeId: 'n12', shopNumber: 'G12', name: 'Mugg & Bean' },
  { nodeId: 'n7', shopNumber: '7', name: 'Pep' },
]

describe('normShop', () => {
  it('normalises shop numbers', () => {
    expect(normShop('SHOP 050')).toBe('50')
    expect(normShop('050')).toBe('50')
    expect(normShop('Shop G-12')).toBe('G12')
    expect(normShop('0')).toBe('0')
    expect(normShop('  ')).toBeNull()
  })
})

describe('autoMatchMeters', () => {
  it('register rows first: exact is pre-ticked, llm and unmapped never are', () => {
    const p = autoMatchMeters({
      meters: [m('mA', { serials: ['S1'] }), m('mB', { label: 'TENANT-23' }), m('mC', { label: 'TENANT-24' })],
      tenants,
      register: [
        { fileName: null, shopNo: 'SHOP 050', tenantName: 'Checkers', serial: 'S1', matchMethod: 'exact', confirmed: false },
        { fileName: 'SITE YA, SHOP 012, TENANT-23, 3000.csv', shopNo: 'G12', tenantName: 'Mugg', serial: null, matchMethod: 'llm', confirmed: false },
        { fileName: 'TENANT-24.csv', shopNo: '7', tenantName: 'Pep', serial: null, matchMethod: 'unmapped', confirmed: false },
      ],
      assignedMeterIds: new Set(),
    })
    expect(p.find((x) => x.meterId === 'mA')).toMatchObject({ nodeId: 'n50', source: 'serial', confidence: 'high', preTicked: true })
    expect(p.find((x) => x.meterId === 'mB')).toMatchObject({ nodeId: 'n12', source: 'register', confidence: 'low', preTicked: false })
    expect(p.find((x) => x.meterId === 'mC')).toMatchObject({ nodeId: 'n7', preTicked: false })
  })

  it('a confirmed llm row is trusted', () => {
    const p = autoMatchMeters({
      meters: [m('mB', { label: 'TENANT-23' })], tenants,
      register: [{ fileName: 'TENANT-23.csv', shopNo: 'G12', tenantName: null, serial: null, matchMethod: 'llm', confirmed: true }],
      assignedMeterIds: new Set(),
    })
    expect(p[0]).toMatchObject({ preTicked: true, confidence: 'high' })
  })

  it('then file-name shop numbers, then labels (label matches are not pre-ticked)', () => {
    const p = autoMatchMeters({
      meters: [m('m1', { shopNo: 'SHOP 7' }), m('m2', { label: 'Mugg & Bean' })], tenants, register: [], assignedMeterIds: new Set(),
    })
    expect(p).toEqual([
      expect.objectContaining({ meterId: 'm1', nodeId: 'n7', source: 'shop_no', preTicked: true }),
      expect.objectContaining({ meterId: 'm2', nodeId: 'n12', source: 'label', confidence: 'medium', preTicked: false }),
    ])
  })

  it('skips meters already assigned and meters that are not tenant load', () => {
    const p = autoMatchMeters({
      meters: [m('m1', { shopNo: '7' }), m('m2', { shopNo: '050', kind: 'solar' }), m('m3', { shopNo: 'G12', kind: 'bulk' })],
      tenants, register: [], assignedMeterIds: new Set(['m1']),
    })
    expect(p).toEqual([])
  })

  it('a tenant chosen on the meter (import "Link to tenant") comes first, high and pre-ticked (LS-02)', () => {
    const p = autoMatchMeters({
      // The shop number in the file name says n7; the person importing chose n50. Their choice wins.
      meters: [m('m1', { shopNo: '7', nodeId: 'n50' }), m('m2', { nodeId: 'gone' })],
      tenants, register: [], assignedMeterIds: new Set(),
    })
    expect(p).toEqual([expect.objectContaining({ meterId: 'm1', nodeId: 'n50', source: 'linked', confidence: 'high', preTicked: true })])
  })
})
