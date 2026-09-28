import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { CellFixture } from '../parsers/grid'
import { buildIngestPlan } from './build-plan'
import lephalaleFx from '../__fixtures__/lp-lephalale.cells.json'
import hf25 from '../__fixtures__/eskom-2025-homeflex.cells.json'
import go25 from '../__fixtures__/eskom-2025-gen-offset.cells.json'
import lf25 from '../__fixtures__/eskom-2025-loss-factors.cells.json'

async function workbook(...fixtures: unknown[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const f of fixtures as CellFixture[]) {
    const ws = wb.addWorksheet(f.source.sheet)
    for (const [addr, v] of Object.entries(f.cells)) ws.getCell(addr).value = v
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
const SHA = 'c'.repeat(64)

describe('buildIngestPlan', () => {
  it('province compendium: one municipal year per sheet, July-June', async () => {
    const plan = await buildIngestPlan({ parser: 'province_xlsx', fileName: 'Limpopo-Province.xlsx', bytes: await workbook(lephalaleFx), sha256: SHA, financialYear: '2025/26' })
    expect(plan.source).toMatchObject({ kind: 'tariff_book', status: 'nersa_approved', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(plan.years).toHaveLength(1)
    expect(plan.years[0]).toMatchObject({ licenseeName: 'LEPHALALE', kind: 'municipal', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: 10.39 })
    expect(plan.years[0].aliases).toContain('LEPHALALE')
  })
  it('Eskom workbook: one Eskom year, April-March, loss factors and the Net-Billing rule', async () => {
    const plan = await buildIngestPlan({ parser: 'eskom_xlsm', fileName: 'Eskom-tariffs-1-April-2025-ver-2.xlsm', bytes: await workbook(hf25, go25, lf25), sha256: SHA, financialYear: '2025/26' })
    const y = plan.years[0]
    expect(y).toMatchObject({ licenseeName: 'Eskom', kind: 'eskom', effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31' })
    expect(y.lossFactors).toHaveLength(10)
    expect(y.ssegRule).toMatchObject({ crediting: 'net_billing_tou', fyEndMonth: 3 })
    expect(y.tariffs.find((t) => t.code === 'HF101N')?.exportTariffCode).toBe('GOHF101N')
  })
  it('RfD PDF text: needs the licensee name, counts pages', async () => {
    const text = readFileSync(new URL('../__fixtures__/city-power-rfd-2026-27.excerpt.txt', import.meta.url), 'utf8')
    await expect(buildIngestPlan({ parser: 'rfd_pdf', fileName: 'x.pdf', bytes: new Uint8Array(), sha256: SHA, financialYear: '2026/27', pdfText: text })).rejects.toThrow(/licensee/)
    const plan = await buildIngestPlan({ parser: 'rfd_pdf', fileName: 'x.pdf', bytes: new Uint8Array(), sha256: SHA, financialYear: '2026/27', pdfText: text, licenseeName: 'CITY POWER' })
    expect(plan.source).toMatchObject({ kind: 'nersa_decision', contentType: 'application/pdf' })
    expect(plan.years[0]).toMatchObject({ licenseeName: 'CITY POWER', approvedIncreasePct: 9.01, effectiveFrom: '2026-07-01' })
  })
})
