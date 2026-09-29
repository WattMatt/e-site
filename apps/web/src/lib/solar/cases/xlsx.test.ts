// @vitest-environment node
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildFinancialsWorkbook } from './xlsx'

const row = {
  created_at: '2026-09-28T10:00:00Z', engine_version: '0.1.0',
  tariff_ref: { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' },
  fin_inputs: { config: { analysis: { years: 2, discountRatePct: 11 }, opex: { insurancePctOfCapex: 0.5 } }, finance: {} },
  results: {
    capex: { exclVatZar: 1_000_000, vatZar: 150_000, inclVatZar: 1_150_000, zarPerWp: 10, byCategory: { modules: 1_000_000 } },
    year1Bills: { beforeZar: 900_000, afterZar: 700_000, afterPvOnlyZar: 700_000, exportCreditUsedZar: 0 },
    finance: { lcoeZarPerKwh: 0.9, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_000_000, npvZar: 123_456.78, irr: 0.18, simplePaybackYears: 5.1, discountedPaybackYears: 7.2,
      rows: [{ year: 1, energyKwh: 100, billBeforeZar: 900, billAfterZar: 700, savingZar: 200, opexZar: 10, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 190, cumulativeZar: -999_810 }] }] }] },
    tornado: { model: 'cash', view: 'owner', baseNpvZar: 123_456.78, swing: 0.2, bars: [{ variable: 'capex', lowNpvZar: 300_000, highNpvZar: -50_000, spreadZar: 350_000 }] },
  },
}

describe('buildFinancialsWorkbook', () => {
  it('has every assumption, the capex, one cashflow sheet per model/view, and the tornado', async () => {
    const buf = await buildFinancialsWorkbook({ projectName: 'KINGSWALK', caseName: 'Base', row, capexLines: [{ category: 'modules', description: 'PV', qty: 100_000, unit: 'Wp', rateZar: 10 }] })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as never)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Assumptions', 'Capex', 'Cash - owner', 'Sensitivity'])
    const a = wb.getWorksheet('Assumptions')!
    const keys = a.getColumn(1).values as unknown[]
    expect(keys).toEqual(expect.arrayContaining(['analysis.years', 'analysis.discountRatePct', 'opex.insurancePctOfCapex', 'Tariff', 'Engine version']))
    const cf = wb.getWorksheet('Cash - owner')!
    expect(cf.getRow(1).values).toEqual(expect.arrayContaining(['Year', 'Net (R)', 'Cumulative (R)']))
    expect(cf.getCell('B2').value).toBe(1)
    expect(cf.getCell('L2').value).toBe(-999_810)
    expect(wb.getWorksheet('Sensitivity')!.getCell('A2').value).toBe('Capex')
    expect(wb.getWorksheet('Capex')!.getCell('F2').value).toBe(1_000_000)
  })
})
