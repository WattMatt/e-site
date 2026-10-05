import { describe, expect, it } from 'vitest'
import { planIngest, collapseObservations, type IngestLine } from './ingest-plan'

const line = (over: Partial<IngestLine>): IngestLine => ({
  sheet: null, rowRef: null, code: null, sectionPath: ['CONDUIT'], description: '20mm Ø', unit: 'm', quantity: 10,
  supplyRate: 5.15, installRate: 4.5, rate: null, amount: 96.5, quantityMode: 'measured', ...over,
})

describe('planIngest', () => {
  it('auto-confirms rule matches, creates their items once, collapses identical rates', () => {
    const plan = planIngest([
      line({ rowRef: 'a' }), line({ rowRef: 'b' }), line({ rowRef: 'c', supplyRate: 6 }),
    ], [])
    expect(plan.lines.map(l => l.status)).toEqual(['auto_confirmed', 'auto_confirmed', 'auto_confirmed'])
    expect(plan.newItems).toHaveLength(1)
    expect(plan.newItems[0]).toMatchObject({ signature: 'conduit|m|dia=20|material=pvc', code: 'CONDUIT-20-PVC-M', category: 'conduit', unit: 'm' })
    expect(plan.observations).toEqual([
      { signature: 'conduit|m|dia=20|material=pvc', unit: 'm', supplyRate: 5.15, installRate: 4.5, rate: 9.65, occurrences: 2, lineIndexes: [0, 1] },
      { signature: 'conduit|m|dia=20|material=pvc', unit: 'm', supplyRate: 6, installRate: 4.5, rate: 10.5, occurrences: 1, lineIndexes: [2] },
    ])
  })

  it('reuses an existing catalogue item rather than creating a duplicate', () => {
    const plan = planIngest([line({})], [{ id: 'i1', signature: 'conduit|m|dia=20|material=pvc', category: 'conduit', unit: 'm', attributes: { dia: '20', material: 'pvc' } }])
    expect(plan.newItems).toEqual([])
  })

  it('excludes non-rates with their reason', () => {
    const plan = planIngest([line({ quantityMode: 'pc_sum', description: 'Prime cost', unit: 'Sum' })], [])
    expect(plan.lines[0]).toMatchObject({ status: 'excluded', exclusionReason: 'pc_or_provisional' })
    expect(plan.observations).toEqual([])
  })

  it('suggests (never confirms) the one item a partial match fits; otherwise leaves it unmatched', () => {
    const items = [
      { id: 'i1', signature: 'lv_cable|m|conductor=cu|cores=4|install=ground|size=240', category: 'lv_cable' as const, unit: 'm', attributes: { conductor: 'cu', cores: '4', install: 'ground', size: '240' } },
      { id: 'i2', signature: 'lv_cable|m|conductor=cu|cores=4|install=tray|size=95', category: 'lv_cable' as const, unit: 'm', attributes: { conductor: 'cu', cores: '4', install: 'tray', size: '95' } },
    ]
    const plan = planIngest([
      line({ sectionPath: ['(UNCATEGORISED)'], description: '4C x 240mm' }),
      line({ sectionPath: ['(UNCATEGORISED)'], description: '4C x 16mm' }),
    ], items)
    expect(plan.lines[0]).toMatchObject({ status: 'suggested', suggestedItemSignature: items[0].signature })
    expect(plan.lines[1]).toMatchObject({ status: 'unmatched', suggestedItemSignature: null })
    expect(plan.observations).toEqual([])
  })

  it('gives every line a group key so the queue reviews identical text once', () => {
    const plan = planIngest([line({ sectionPath: ['LIGHTS'], description: 'Type A fitting', unit: 'No' }),
      line({ sectionPath: ['Lights'], description: 'type a fitting', unit: 'no' })], [])
    expect(plan.lines[0].groupKey).toBe(plan.lines[1].groupKey)
    expect(plan.lines[0].status).toBe('unmatched')
  })
})

describe('collapseObservations', () => {
  it('keys on item and the exact rates, counting occurrences', () => {
    const c = collapseObservations([
      { key: 'x', unit: 'm', supplyRate: 1, installRate: 2, rate: 3, lineIndex: 0 },
      { key: 'x', unit: 'm', supplyRate: 1, installRate: 2, rate: 3, lineIndex: 4 },
      { key: 'y', unit: 'm', supplyRate: 1, installRate: 2, rate: 3, lineIndex: 5 },
    ])
    expect(c).toEqual([
      { key: 'x', unit: 'm', supplyRate: 1, installRate: 2, rate: 3, occurrences: 2, lineIndexes: [0, 4] },
      { key: 'y', unit: 'm', supplyRate: 1, installRate: 2, rate: 3, occurrences: 1, lineIndexes: [5] },
    ])
  })
})
