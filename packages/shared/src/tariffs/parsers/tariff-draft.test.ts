import { describe, expect, it } from 'vitest'
import { finishDraft, inferStructure, newDraft } from './tariff-draft'
import { makeCharge, type Charge } from '../types'

const e = (p: Partial<Charge>) => makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2, ...p })

describe('inferStructure', () => {
  it('reads the structure off the energy charges', () => {
    expect(inferStructure([e({})])).toBe('flat')
    expect(inferStructure([e({ season: 'low' }), e({ season: 'high' })])).toBe('seasonal')
    expect(inferStructure([e({ blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly' })])).toBe('ibt')
    expect(inferStructure([e({ blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly', season: 'low' })])).toBe('seasonal_ibt')
    expect(inferStructure([e({ tou: 'peak' })])).toBe('tou')
  })
})

describe('finishDraft', () => {
  it('splits a single-rate energy charge off an IBT tariff into a variant (Ekurhuleni row 8)', () => {
    const d = newDraft({ name: 'Domestic IBT Tariff A', fileSha256: 'x', sheet: 'S', headerRow: 3 })
    d.charges.push(
      e({ blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' }),
      e({ blockMinKwh: 50, blockMaxKwh: null, blockBasis: 'monthly' }),
      e({ label: 'Single rate energy charge', amountExclVat: 2.4574 }),
    )
    const out = finishDraft(d, new Set())
    expect(out.tariffs.map((t) => [t.name, t.structure, t.charges.length])).toEqual([
      ['Domestic IBT Tariff A', 'ibt', 2],
      ['Domestic IBT Tariff A (single rate)', 'flat', 1],
    ])
  })
  it('skips a legacy header with no charges and says so', () => {
    const d = newDraft({ name: 'Scale 4B', fileSha256: 'x', sheet: 'S', headerRow: 71 })
    d.isLegacy = true
    const out = finishDraft(d, new Set())
    expect(out.tariffs).toEqual([])
    expect(out.issues[0]).toMatchObject({ code: 'legacy_tariff_skipped', locator: { row: 71 } })
  })
  it('keeps names unique within a book by suffixing the header row', () => {
    const taken = new Set<string>()
    const a = newDraft({ name: 'Domestic', fileSha256: 'x', sheet: 'S', headerRow: 3 })
    a.charges.push(e({}))
    const b = newDraft({ name: 'DOMESTIC', fileSha256: 'x', sheet: 'S', headerRow: 9 })
    b.charges.push(e({}))
    expect(finishDraft(a, taken).tariffs[0].name).toBe('Domestic')
    expect(finishDraft(b, taken).tariffs[0].name).toBe('DOMESTIC [row 9]')
  })
  it('flags an SSEG tariff whose import/export meaning is unknown', () => {
    const d = newDraft({ name: '16. SSEG (New)', fileSha256: 'x', sheet: 'S', headerRow: 181 })
    d.charges.push(e({ tou: 'peak' }))
    const out = finishDraft(d, new Set())
    expect(out.tariffs[0].category).toBe('sseg')
    expect(out.issues.map((i) => i.code)).toContain('sseg_semantics_unknown')
  })
})
