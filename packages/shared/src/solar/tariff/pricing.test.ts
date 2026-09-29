import { describe, expect, it } from 'vitest'
import { costMonth } from '../../tariffs/bill-engine'
import { GOLDEN_BILLS } from '../../tariffs/__fixtures__/golden-bills'
import { makeCharge, makeTariff, type Tariff } from '../../tariffs/types'
import { netBillingRule } from '../../tariffs/net-billing-rules'
import { tariffBillCalculator } from '../../services/solar/finance/tariff-bill-calculator'
import { runBillCheck } from './bill-check'
import { buildEscalationRows, escalationPathFromRows, escalationSettingsFrom } from './escalation'
import type { OverrideChargeRow } from './override'
import { resolveStudyPricing, studyPricingHash, type StudyPricingInput } from './pricing'

const flat = (energyCents: number, extra: Tariff['charges'] = []): Tariff => makeTariff({ name: 'Business Flat', structure: 'flat', charges: [
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: energyCents }),
  makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 500 }),
  ...extra,
] })

function overrideRow(p: Partial<OverrideChargeRow> & Pick<OverrideChargeRow, 'id' | 'component' | 'unit' | 'amountExclVat'>): OverrideChargeRow {
  return {
    baseChargeId: null, season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null, blockBasis: null,
    demandBasis: null, vatRate: 0.15, vatBasis: 'stated_excl', sourceLocator: {}, reason: null, editedAt: null, editedBy: null, updatedAt: '', ...p,
  }
}

function input(p: Partial<StudyPricingInput> & { tariff?: Tariff } = {}): StudyPricingInput {
  const { tariff, ...rest } = p
  return {
    study: { tariffOverrideId: null, exportRule: null, escalation: null, loadGrowthPct: null },
    published: { tariffId: 't1', tariff: tariff ?? flat(250), financialYear: '2025/26', licenseeKind: 'municipal', exportTariff: null, sseg: null,
      years: [{ financialYear: '2025/26', approvedIncreasePct: 12.7 }, { financialYear: '2026/27', approvedIncreasePct: 10.1 }] },
    override: null,
    exportRates: [],
    orgSettings: {},
    ...rest,
  }
}

/** One flat kW for every hour of March 2025 (744 h), nothing elsewhere: the run's hourly import. */
function marchOnly(): Float64Array {
  const a = new Float64Array(8760)
  const start = (31 + 28) * 24
  for (let h = start; h < start + 31 * 24; h++) a[h] = 1
  return a
}
const NO_TOU = { highSeasonMonths: [], windows: [], holidayTreatedAs: null, source: 'assumed_eskom' as const }

describe('resolveStudyPricing', () => {
  describe('(a) with no override and no stored rule, every golden tariff case reproduces exactly', () => {
    for (const g of GOLDEN_BILLS) {
      it(`case ${g.id} -> R${g.totalExclVat}`, () => {
        const p = resolveStudyPricing(input({
          tariff: g.tariff,
          published: { ...input().published, tariff: g.tariff, exportTariff: g.exportTariff ?? null, sseg: g.sseg ?? null, licenseeKind: g.sseg ? 'eskom' : 'municipal' },
        }))
        // The same tariff, charges in the resolver's canonical order.
        expect({ ...p.tariff, charges: [] }).toEqual({ ...g.tariff, charges: [] })
        expect(p.tariff.charges).toHaveLength(g.tariff.charges.length)
        expect(p.tariff.charges).toEqual(expect.arrayContaining(g.tariff.charges))
        expect(costMonth(p.tariff, g.usage, { exportTariff: p.exportTariff, sseg: p.ssegRule }).totalExclVat).toBe(g.totalExclVat)
      })
    }
  })

  it('(b) an override rate changed with a reason prices the SAME monthly bill in the Tariff tab bill check and in a run’s year-1 bills', () => {
    const base = flat(250)
    const ov = { id: 'ov1', rows: [
      overrideRow({ id: 'oc1', component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, reason: 'Landlord resale mark-up (lease cl. 14)' }),
      overrideRow({ id: 'oc2', component: 'basic', unit: 'R_per_month', amountExclVat: 500 }),
    ] }
    const p = resolveStudyPricing(input({ tariff: base, study: { ...input().study, tariffOverrideId: 'ov1' }, override: ov }))
    const check = runBillCheck(p.tariff, { year: 2025, month: 3, importKwh: { peak: 0, standard: 744, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 1, note: null },
      { highSeasonMonths: null, nmdKva: null })
    const calc = tariffBillCalculator(p.tariff, { calendar: NO_TOU, referenceYear: 2025, exportTariff: p.exportTariff, sseg: p.ssegRule })
    const march = calc.monthlyBills({ importKwh: marchOnly(), exportKwh: new Float64Array(8760) })[2]!
    expect(check.modelledTotalExclVat).toBe(2732) // 744 kWh × R3.00 + R500
    expect(march.totalZar).toBeCloseTo(check.modelledTotalExclVat, 6)
    expect(p.provenance.overrideId).toBe('ov1')
    // The published tariff alone would have been 744 × 2.50 + 500.
    const pub = resolveStudyPricing(input({ tariff: base }))
    expect(runBillCheck(pub.tariff, { year: 2025, month: 3, importKwh: { peak: 0, standard: 744, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 1, note: null },
      { highSeasonMonths: null, nmdKva: null }).modelledTotalExclVat).toBe(2360)
  })

  it('an override the study does not point at is not applied', () => {
    const p = resolveStudyPricing(input({ override: { id: 'ov1', rows: [overrideRow({ id: 'oc1', component: 'energy', unit: 'c_per_kWh', amountExclVat: 999 })] } }))
    expect(p.tariff.charges[0]!.amountExclVat).toBe(250)
    expect(p.provenance.overrideId).toBeNull()
  })

  describe('(c) the export rule changes the export credit', () => {
    const usage = { year: 2025, month: 3, days: 31, season: 'low' as const, importKwh: { peak: 0, standard: 200, off_peak: 0 }, exportKwh: { peak: 0, standard: 100, off_peak: 0 } }
    const withOwnExport = flat(250, [makeCharge({ component: 'export_credit', unit: 'c_per_kWh', amountExclVat: 100 })])
    const credit = (p: ReturnType<typeof resolveStudyPricing>) => costMonth(p.tariff, usage, { exportTariff: p.exportTariff, sseg: p.ssegRule }).credit.used

    it('manual R0.85/kWh credits 100 kWh at R85.00 (municipal net billing, the rule the Tariff tab shows)', () => {
      const p = resolveStudyPricing(input({
        tariff: withOwnExport,
        study: { ...input().study, exportRule: { version: 1, method: 'manual' } },
        exportRates: [{ id: 'r1', season: 'all', tou: 'all', unit: 'R_per_kWh', amountExclVat: 0.85, sourceNote: 'City SSEG schedule p4' }],
      }))
      expect(p.exportMethod).toBe('manual')
      expect(p.exportCredited).toBe(true)
      expect(p.ssegFromLibrary).toBe(false)
      expect(p.ssegRule).toEqual(netBillingRule('municipal'))
      expect(credit(p)).toBe(85)
      expect(p.provenance.exportSourceNote).toBe('City SSEG schedule p4')
    })

    it('"none" credits nothing, even when the tariff carries its own export_credit rows', () => {
      const p = resolveStudyPricing(input({ tariff: withOwnExport, study: { ...input().study, exportRule: { version: 1, method: 'none' } } }))
      expect(p.exportCredited).toBe(false)
      expect(p.ssegRule.crediting).toBe('none')
      expect(credit(p)).toBe(0)
      // Control: the same tariff with its own rate under a crediting rule does earn credit.
      const own = resolveStudyPricing(input({ tariff: withOwnExport, published: { ...input().published, tariff: withOwnExport, sseg: netBillingRule('municipal') },
        study: { ...input().study, exportRule: { version: 1, method: 'linked_tariff' } } }))
      expect(credit(own)).toBe(100)
    })

    it('with no stored rule, no linked export tariff defaults to "none" and a linked one to "linked_tariff" (the Tariff tab default)', () => {
      expect(resolveStudyPricing(input()).exportMethod).toBe('none')
      const linked = makeTariff({ name: 'Gen-offset', structure: 'flat', category: 'sseg', charges: [makeCharge({ component: 'export_credit', unit: 'c_per_kWh', amountExclVat: 60 })] })
      const p = resolveStudyPricing(input({ published: { ...input().published, exportTariff: linked } }))
      expect(p.exportMethod).toBe('linked_tariff')
      expect(p.exportTariff).toEqual(linked)
    })

    it('a manual rule with no rate rows is priced as "none" (00220 makes it unreachable)', () => {
      const p = resolveStudyPricing(input({ study: { ...input().study, exportRule: { version: 1, method: 'manual' } } }))
      expect(p.exportMethod).toBe('none')
      expect(p.exportCredited).toBe(false)
    })
  })

  it('escalation is the Tariff tab path: published approved increases, then stored overrides, then the org default', () => {
    const settings = escalationSettingsFrom({})
    const stored = { version: 1, overrides: { 3: 4.5 } }
    const p = resolveStudyPricing(input({ published: { ...input().published, financialYear: '2025/26', years: [{ financialYear: '2026/27', approvedIncreasePct: 10.1 }] },
      study: { ...input().study, escalation: stored } }))
    const rows = buildEscalationRows({ pinnedFinancialYear: '2025/26', published: [{ financialYear: '2026/27', approvedIncreasePct: 10.1 }], settings, stored })
    expect(p.escalationRows).toEqual(rows)
    expect(p.escalationPath).toEqual(escalationPathFromRows(rows, settings))
    expect(p.escalationPath.published[0]).toBeCloseTo(0.101, 9)
    expect(p.escalationPath.published[1]).toBeCloseTo(0.045, 9)
  })

  it('load growth comes from the study (Load tab), NULL → 0', () => {
    expect(resolveStudyPricing(input()).loadGrowthPct).toBe(0)
    expect(resolveStudyPricing(input({ study: { ...input().study, loadGrowthPct: '3' } })).loadGrowthPct).toBe(3)
  })
})

describe('studyPricingHash', () => {
  const manual = (amount: number, id = 'r1') => input({
    study: { ...input().study, exportRule: { version: 1, method: 'manual' } },
    exportRates: [{ id, season: 'all', tou: 'all', unit: 'R_per_kWh', amountExclVat: amount, sourceNote: 'note' }],
  })
  const h = (i: StudyPricingInput) => studyPricingHash(resolveStudyPricing(i))

  it('is stable for the same inputs', () => {
    expect(h(input())).toBe(h(input()))
    expect(h(input())).toMatch(/^[0-9a-f]{64}$/)
  })
  it('moves with each of the four pricing inputs', () => {
    const base = h(input())
    const ov = input({ study: { ...input().study, tariffOverrideId: 'ov1' },
      override: { id: 'ov1', rows: [overrideRow({ id: 'oc1', component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, reason: 'resale' })] } })
    expect(h(ov)).not.toBe(base)
    expect(h(manual(0.85))).not.toBe(base)
    expect(h(manual(0.86))).not.toBe(h(manual(0.85)))
    expect(h(input({ study: { ...input().study, escalation: { version: 1, overrides: { 4: 6 } } } }))).not.toBe(base)
    expect(h(input({ study: { ...input().study, loadGrowthPct: 3 } }))).not.toBe(base)
  })
  it('moves when a money row id changes (provenance is part of the hash)', () => {
    expect(h(manual(0.85, 'r1'))).not.toBe(h(manual(0.85, 'r2')))
  })
})

describe('studyPricingHash is independent of the order the database returns rows (review I-A)', () => {
  it('reversed tariff charges, override rows and export rates hash (and price) the same', () => {
    const tariff = flat(250, [makeCharge({ component: 'export_credit', unit: 'c_per_kWh', amountExclVat: 100 })])
    const rows = [
      overrideRow({ id: 'oc1', component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, reason: 'resale' }),
      overrideRow({ id: 'oc2', component: 'basic', unit: 'R_per_month', amountExclVat: 500 }),
    ]
    const rates = [
      { id: 'r1', season: 'high' as const, tou: 'all' as const, unit: 'R_per_kWh' as const, amountExclVat: 0.9, sourceNote: 'n' },
      { id: 'r2', season: 'low' as const, tou: 'all' as const, unit: 'R_per_kWh' as const, amountExclVat: 0.8, sourceNote: 'n' },
    ]
    const mk = (rev: boolean) => input({
      tariff: rev ? { ...tariff, charges: [...tariff.charges].reverse() } : tariff,
      study: { ...input().study, tariffOverrideId: 'ov1', exportRule: { version: 1, method: 'manual' } },
      override: { id: 'ov1', rows: rev ? [...rows].reverse() : rows },
      exportRates: rev ? [...rates].reverse() : rates,
    })
    expect(studyPricingHash(resolveStudyPricing(mk(true)))).toBe(studyPricingHash(resolveStudyPricing(mk(false))))
    const pub = (rev: boolean) => input({ tariff: rev ? { ...tariff, charges: [...tariff.charges].reverse() } : tariff })
    expect(studyPricingHash(resolveStudyPricing(pub(true)))).toBe(studyPricingHash(resolveStudyPricing(pub(false))))
  })
})

describe('a season-specific manual export rate wins over an all-season one for the same period (re-review I-1)', () => {
  it('whatever the amounts, and so whatever the canonical order', () => {
    for (const [allAmt, highAmt] of [[0.85, 1.2], [1.2, 0.85]] as const) {
      const p = resolveStudyPricing(input({
        study: { ...input().study, exportRule: { version: 1, method: 'manual' } },
        exportRates: [
          { id: 'ra', season: 'all', tou: 'all', unit: 'R_per_kWh', amountExclVat: allAmt, sourceNote: 'n' },
          { id: 'rh', season: 'high', tou: 'all', unit: 'R_per_kWh', amountExclVat: highAmt, sourceNote: 'n' },
        ],
      }))
      const credit = (month: number, season: 'high' | 'low') => costMonth(p.tariff, { year: 2025, month, days: 30, season,
        importKwh: { peak: 0, standard: 200, off_peak: 0 }, exportKwh: { peak: 0, standard: 100, off_peak: 0 } },
        { exportTariff: p.exportTariff, sseg: p.ssegRule }).credit.used
      expect(credit(7, 'high')).toBeCloseTo(100 * highAmt, 6)
      expect(credit(3, 'low')).toBeCloseTo(100 * allAmt, 6)
    }
  })
})
