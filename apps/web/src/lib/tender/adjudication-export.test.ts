import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { adjudicate, type AdjItem } from './adjudication'
import { buildAdjudicationWorkbook, safeText } from './adjudication-export'

const items: AdjItem[] = [
  { id: 'a', sheet_name: 'B1', row_number: 5, bill_code: '1', code: '1.1', description: 'Cable', unit: 'm', quantity: 100, rate_cell_type: 'priced', fixed_amount: null },
  { id: 'c', sheet_name: 'B2', row_number: 5, bill_code: '2', code: '2.1', description: 'PS', unit: 'Sum', quantity: 1, rate_cell_type: 'fixed', fixed_amount: 5000 },
]

describe('buildAdjudicationWorkbook', () => {
  it('writes ranked totals, the item comparison, the checklist and flags', async () => {
    const a = adjudicate(
      items,
      { a: { rate: 11, amount: 1100 } },
      [
        { participantId: 'x', company: 'Alpha', submittedAt: '2026-10-10T10:00:00Z', lines: { a: { rate: 20, not_priced: false } } },
        { participantId: 'y', company: 'Beta', submittedAt: '2026-10-10T11:00:00Z', lines: { a: { rate: 10, not_priced: false } } },
      ],
      [{ id: 'r1', kind: 'document', label: 'CIDB', mandatory: true }],
      [{ participantId: 'x', documents: { r1: ['cidb.pdf'] }, declarations: [], profile: null }, { participantId: 'y', documents: {}, declarations: [], profile: null }],
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await buildAdjudicationWorkbook(a, { project: 'Sunbird Central', tender: 'Electrical — Main', closedAt: null })) as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Comparison', 'Checklist', 'Flags', 'Arithmetic'])
    const s = wb.getWorksheet('Summary')!
    const ranked = [s.getRow(7).getCell(2).value, s.getRow(8).getCell(2).value]
    expect(ranked).toEqual(['Beta', 'Alpha'])
    expect(s.getRow(7).getCell(4).value).toBe(1000 + 5000)
    expect(s.getRow(9).getCell(2).value).toBe('WM estimate')
    const cmp = wb.getWorksheet('Comparison')!
    expect(cmp.getRow(1).getCell(9).value).toBe('Beta rate')
    expect(cmp.getRow(2).getCell(9).value).toBe(10)
    expect(cmp.getRow(2).getCell(12).value).toBe(2000)
    const k = wb.getWorksheet('Checklist')!
    expect(String(k.getRow(2).getCell(5).value)).toContain('cidb.pdf')
    expect(String(k.getRow(2).getCell(4).value)).toContain('missing')
    // Alpha's 20 is 82 % above WM's 11: shaded, with the reason in a note.
    expect(cmp.getRow(2).getCell(11).value).toBe(20)
    expect((cmp.getRow(2).getCell(11).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb).toBe('FFFDE2E1')
    expect(String(cmp.getRow(2).getCell(11).note)).toMatch(/above WM's estimate/)
    expect((cmp.getRow(2).getCell(9).fill as ExcelJS.FillPattern | undefined)?.fgColor).toBeUndefined()
    // VAT in cents: excl + VAT = incl exactly.
    const r7 = s.getRow(7)
    expect(Math.round(((r7.getCell(4).value as number) + (r7.getCell(5).value as number)) * 100)).toBe(Math.round((r7.getCell(6).value as number) * 100))
  })

  it('writes bidder text inert, disambiguates equal names, and lists WM\u2019s own arithmetic errors', async () => {
    expect(safeText('=HYPERLINK("http://x","y")')).toBe('\'=HYPERLINK("http://x","y")')
    expect(safeText('Acme')).toBe('Acme')
    const a = adjudicate(
      items,
      { a: { rate: 11, amount: 1200 } },
      [
        { participantId: 'x', company: '=cmd', submittedAt: null, lines: { a: { rate: 20, not_priced: false } } },
        { participantId: 'y', company: '=cmd', submittedAt: null, lines: { a: { rate: 10, not_priced: false } } },
      ],
      [],
      [],
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await buildAdjudicationWorkbook(a, { project: 'P', tender: 'T', closedAt: null })) as unknown as ArrayBuffer)
    const s = wb.getWorksheet('Summary')!
    expect([s.getRow(7).getCell(2).value, s.getRow(8).getCell(2).value]).toEqual(["'=cmd", "'=cmd (2)"])
    const ar = wb.getWorksheet('Arithmetic')!
    expect([ar.getRow(3).getCell(5).value, ar.getRow(3).getCell(6).value, ar.getRow(3).getCell(7).value]).toEqual([1200, 1100, 100])
  })
})
