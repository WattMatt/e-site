import { describe, it, expect } from 'vitest'
import type { CaseRunOutputs } from '../cases/outputs'
import { buildSolarReportModel, type SolarReportInput } from './report-model'

const monthly = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1, pvKwh: 70_000, loadKwh: 120_000, importBeforeKwh: 120_000, importKwh: 60_000, exportKwh: 10_000,
  maxDemandBeforeKw: 400, maxDemandAfterKw: 350, touImportBefore: null, touImportAfter: null,
}))
export const outputs = {
  version: 1,
  kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.81, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000,
    selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 5_000, loadKwh: 1_440_000, importBeforeKwh: 1_440_000, importAfterKwh: 740_000,
    solarFraction: 0.486, selfConsumption: 0.834, peakDemandBeforeKw: 420, peakDemandAfterKw: 380, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
  monthly, typicalDays: [], daily: [],
  waterfall: [{ key: 'poa', label: 'Plane-of-array irradiation', kwh: 1_100_000, kind: 'start' }, { key: 'soiling', label: 'Soiling', kwh: -22_000, kind: 'loss' }, { key: 'ac', label: 'AC energy', kwh: 845_000, kind: 'end' }],
  checks: [{ id: 'dc_ac_ratio', label: 'DC/AC ratio', status: 'pass', detail: '1.25' }],
  provenance: { engineVersion: '0.1.0', inputsHash: 'a'.repeat(64), weatherDatasetId: 'w1', weatherSource: 'PVGIS TMY', weatherFetchedAt: '2026-09-01T00:00:00Z', gsaPvoutKwhPerKwp: 1700,
    tariffRef: null, loadBasis: 'metered', loadReferenceYear: 2025 },
} as unknown as CaseRunOutputs

const money = {
  capex: { exclVatZar: 1_000_000, vatZar: 150_000, inclVatZar: 1_150_000, zarPerWp: 2, inverterZar: 200_000, batteryZar: 0, qualifying12bZar: 800_000, byCategory: { modules: 800_000, inverters: 200_000 } },
  year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 20_000 },
  finance: { lcoeZarPerKwh: 0.95, loadShedding: { annualZar: [50_000], npvZar: 400_000 }, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 2.6, discountedPaybackYears: 3.4,
    rows: [{ year: 1, energyKwh: 845_000, billBeforeZar: 1_000_000, billAfterZar: 600_000, savingZar: 400_000, opexZar: 80_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 320_000, cumulativeZar: -680_000 }] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 2_000_000, swing: 0.2, bars: [{ variable: 'capex', lowNpvZar: 2_200_000, highNpvZar: 1_800_000, spreadZar: 400_000 }], omitted: [] },
  tariffName: 'Business 1 (City of Tshwane, 2026/27)',
}

export const reportInput = (kind: 'feasibility' | 'technical'): SolarReportInput => ({
  kind, projectName: 'Acme Mall', address: '1 Main Rd', caseName: 'Base',
  site: { latitude: -25.75, longitude: 28.19, licenseeName: 'City of Tshwane', nmdKva: 800, exportMode: 'net_billing', exportLimitKw: 100 },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00.000Z', outputs },
  money: kind === 'feasibility' ? (money as unknown as SolarReportInput['money']) : null,
  options: { layoutSheetAttached: false, include8760: true },
  disclaimer: 'Org disclaimer text',
  generatedAt: '2026-09-29T08:00:00.000Z',
})

const allText = (m: ReturnType<typeof buildSolarReportModel>) =>
  JSON.stringify(m.sections.map((s) => [s.title, s.paragraphs, s.tables.map((t) => [t.columns, t.rows])]))

describe('buildSolarReportModel', () => {
  it('feasibility carries every spec section in order', () => {
    const m = buildSolarReportModel(reportInput('feasibility'))
    expect(m.sections.map((s) => s.title)).toEqual([
      'Executive summary', 'Site and supply', 'Load analysis', 'Tariff', 'System design', 'Yield',
      'Financials', 'Sensitivity', 'Assumptions and provenance', 'Disclaimers',
    ])
    expect(allText(m)).toContain('R 400 000')
    expect(allText(m)).toContain('21.0 %')
    expect(m.summary).toEqual({ kwp: 500, mwhYear1: 845, saving: 'R 400 000', irrPct: 21, runId: 'r1' })
  })
  it('technical has NO rand value anywhere, even when money is passed by mistake', () => {
    const i = reportInput('technical')
    i.money = reportInput('feasibility').money
    const m = buildSolarReportModel(i)
    expect(m.sections.map((s) => s.title)).not.toContain('Financials')
    expect(m.sections.map((s) => s.title)).not.toContain('Tariff')
    expect(allText(m)).not.toMatch(/R \d|ZAR|R\/kWh|IRR|NPV/)
    expect(m.summary).toEqual({ kwp: 500, mwhYear1: 845, runId: 'r1' })
  })
  it('refuses a feasibility report without stored financial results', () => {
    expect(() => buildSolarReportModel({ ...reportInput('feasibility'), money: null })).toThrow('financial results')
  })
  it('labels the monthly table by position and keeps load-shedding out of the cashflow', () => {
    const m = buildSolarReportModel(reportInput('feasibility'))
    const load = m.sections.find((s) => s.title === 'Load analysis')!
    expect(load.tables[0]!.rows.map((r) => r[0])).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    const fin = m.sections.find((s) => s.title === 'Financials')!
    expect(fin.paragraphs.join(' ')).toContain('reported separately and not included in any cashflow or IRR')
  })
  it('names the run and the hourly export when the 8760 appendix is requested', () => {
    const prov = buildSolarReportModel(reportInput('technical')).sections.find((s) => s.title === 'Assumptions and provenance')!
    expect(prov.paragraphs.join(' ')).toContain('Hourly data (8 760 rows) for run r1')
  })
})
