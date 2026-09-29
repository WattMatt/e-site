// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { CaseRunOutputs } from '@esite/shared/solar-cases'
import { buildSolarReportModel, type SolarReportInput } from '@esite/shared/solar-reports'
import { isWinAnsi } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { solarBranding } from './branding'
import { renderSolarReport } from './render-report'

const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 70_000, loadKwh: 120_000, importBeforeKwh: 120_000, importKwh: 60_000, exportKwh: 10_000, maxDemandBeforeKw: 400, maxDemandAfterKw: 350, touImportBefore: null, touImportAfter: null }))
const outputs = {
  version: 1,
  kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.81, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000, selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 5_000, loadKwh: 1_440_000, importBeforeKwh: 1_440_000, importAfterKwh: 740_000, solarFraction: 0.486, selfConsumption: 0.834, peakDemandBeforeKw: 420, peakDemandAfterKw: 380, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
  monthly, typicalDays: [], daily: [],
  waterfall: [{ key: 'ac', label: 'AC energy', kwh: 845_000, kind: 'end' }],
  checks: [{ id: 'dc_ac_ratio', label: 'DC/AC ratio ≤ 1.3 ✓', status: 'pass', detail: 'Ω check → ok' }],
  provenance: { engineVersion: '0.1.0', inputsHash: 'a'.repeat(64), weatherDatasetId: 'w1', weatherSource: 'PVGIS TMY', weatherFetchedAt: null, gsaPvoutKwhPerKwp: null, tariffRef: null, loadBasis: 'metered', loadReferenceYear: 2025 },
} as unknown as CaseRunOutputs
const money = {
  capex: { exclVatZar: 1_000_000, vatZar: 150_000, inclVatZar: 1_150_000, zarPerWp: 2, inverterZar: 0, batteryZar: 0, qualifying12bZar: 0, byCategory: { modules: 1_000_000 } },
  year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: 0.95, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 2.6, discountedPaybackYears: 3.4, rows: [{ year: 1, energyKwh: 1, billBeforeZar: 0, billAfterZar: 0, savingZar: 400_000, opexZar: 80_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 320_000, cumulativeZar: -680_000 }] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 2_000_000, swing: 0.2, bars: [], omitted: [] },
  tariffName: 'Business 1',
} as unknown as NonNullable<SolarReportInput['money']>
const input = (kind: 'feasibility' | 'technical'): SolarReportInput => ({
  kind, projectName: 'Acme Mall → North', address: null, caseName: 'Base ≤ Ω ✓',
  site: { latitude: -25.75, longitude: 28.19, licenseeName: 'City of Tshwane', nmdKva: 800, exportMode: 'net_billing', exportLimitKw: null },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00.000Z', outputs },
  money: kind === 'feasibility' ? money : null,
  options: { layoutSheetAttached: false, include8760: false },
  disclaimer: 'Org disclaimer ✓', generatedAt: '2026-09-29T08:00:00.000Z',
})
const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall → North' }, { title: 'Solar PV feasibility report', kicker: 'SOLAR FEASIBILITY', date: '2026-09-29' }).branding

describe('renderSolarReport (real render, decoded content streams)', () => {
  it('feasibility: every section heading and the headline money figures are printed', async () => {
    const text = extractPdfText(await renderSolarReport(buildSolarReportModel(input('feasibility')), brand))
    for (const t of ['Executive summary', 'Load analysis', 'Tariff', 'Financials', 'Sensitivity', 'Disclaimers']) expect(squash(text)).toContain(squash(t))
    expect(squash(text)).toContain(squash('R 400 000'))
    expect(squash(text)).toContain(squash('21.0 %'))
  }, 30_000)

  it('no glyph outside WinAnsi reaches the PDF, and the hostile ones are spelled out', async () => {
    const text = extractPdfText(await renderSolarReport(buildSolarReportModel(input('feasibility')), brand))
    const bad = [...text].filter((c) => c !== '\n' && !isWinAnsi(c))
    expect(bad).toEqual([])
    expect(squash(text)).toContain(squash('Base <= Ohm Yes'))
    expect(squash(text)).toContain(squash('DC/AC ratio <= 1.3 Yes'))
    expect(squash(text)).toContain(squash('Ohm check -> ok'))
    expect(text).not.toContain('©')
  }, 30_000)

  it('technical: no rand value, no IRR/NPV, no tariff section', async () => {
    const text = extractPdfText(await renderSolarReport(buildSolarReportModel(input('technical')), brand))
    expect(squash(text)).toContain(squash('Load analysis'))
    for (const banned of ['R400000', 'R1000000', 'IRR', 'NPV', 'Tariff']) expect(squash(text)).not.toContain(banned)
  }, 30_000)
})
