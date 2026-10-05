import { describe, expect, it } from 'vitest'
import { referenceUsedBy } from './reference-used-by'
import { RATING_TABLE_CODES, tableCodeFor } from './sans-lookup.service'

describe('referenceUsedBy', () => {
  it('lists every table the rating auto-fill can return', () => {
    for (const c of ['CU', 'AL'] as const) for (const i of ['PVC', 'XLPE'] as const) {
      const code = tableCodeFor(c, i, '4')!
      expect(RATING_TABLE_CODES as readonly string[]).toContain(code)
      expect(referenceUsedBy(code)[0].use).toMatch(/base current rating/)
    }
  })

  it('marks the derating tables and the SANS 2021 tables that cite them', () => {
    expect(referenceUsedBy('TABLE_6_3_3')[0].use).toMatch(/Derating factor/)
    expect(referenceUsedBy('SANS_10142_1_2021_T6_13')[0].use).toMatch(/TABLE_6_3_3/)
  })

  it('claims nothing for reference-only tables or a superseded edition', () => {
    expect(referenceUsedBy('TABLE_4_2')).toEqual([])
    expect(referenceUsedBy('TABLE_6_9')).toEqual([])
    expect(referenceUsedBy('SANS_10142_1_2017_T6_13')).toEqual([])
  })
})
