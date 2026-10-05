// @vitest-environment node
/**
 * The exports read back: the workbook through exceljs, the PDF by inflating its content streams
 * and decoding the WinAnsi hex runs (latin1 would make punctuation assertions vacuous, PR #161).
 */
import zlib from 'node:zlib'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff, type TouCalendar } from '@esite/shared'
import { composeView, type SourceRow } from './compose'
import { buildExportModel } from './export-model'
import { fmtCell, renderLoadProfilePdf } from './export-pdf'
import { buildLoadProfileWorkbook } from './export-xlsx'
import type { LoadProfileView } from './view-types'

const meter: SourceRow = {
  id: 'm', kind: 'meter', label: 'Bulk meter', included: true, file_name: 'bulk.csv', format: 'C', source_column: 'P1 (kWh)', kva_column: null,
  interval_min: 60, first_ts_end: new Date(Date.UTC(2025, 0, 1) - 7_200_000 + 3_600_000).toISOString(),
  values: Array(8760).fill(10), quality: Array(8760).fill(0), kva_values: null,
  conversion: 'kWh per 60 min × 1 → average kW', quality_report: null, params: null,
}
const flat: TouCalendar = {
  highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
  windows: (['high', 'low'] as const).flatMap((season) => (['weekday', 'saturday', 'sunday'] as const).map((dayType) => ({ season, dayType, startMinute: 0, endMinute: 1440, period: 'off_peak' as const }))),
}
const tariff = makeTariff({ name: 'Flat ≤ 100 kVA', structure: 'tou', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, tou: 'off_peak' })] })

function view(): LoadProfileView {
  const c = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, sources: [meter], tenants: [], includeHourly: true, costing: { tariffId: 't', tariff, calendar: flat, calendarAssumedEskom: false, label: 'Test City · 2025/26 · Flat ≤ 100 kVA' } })
  return { projectId: 'p', projectName: 'Mall Ω', canEdit: false, profileId: 'x', settings: { referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tariffId: 't' }, tenants: { count: 0, withArea: 0, totalAreaM2: 0 }, ...c }
}

const WINANSI_HIGH = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178]
function pdfText(buf: Buffer): string {
  let all = ''
  let cursor = 0
  for (;;) {
    const start = buf.indexOf('stream', cursor)
    if (start === -1) break
    const end = buf.indexOf('endstream', start)
    if (end === -1) break
    let d = start + 6
    while (buf[d] === 0x0d || buf[d] === 0x0a) d++
    let decoded: string
    try { decoded = zlib.inflateSync(buf.subarray(d, end)).toString('latin1') } catch { decoded = '' }
    for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) {
      for (const ch of Buffer.from(m[1], 'hex')) all += ch >= 0x80 && ch <= 0x9f ? (WINANSI_HIGH[ch - 0x80] ? String.fromCharCode(WINANSI_HIGH[ch - 0x80]) : '') : String.fromCharCode(ch)
    }
    all += ' '
    cursor = end + 9
  }
  return all.replace(/\s+/g, ' ')
}

describe('load profile exports', () => {
  const model = buildExportModel(view(), new Date('2026-10-05T10:00:00Z'))

  it('refuses to export an empty profile', () => {
    expect(() => buildExportModel({ ...view(), analysis: null, cost: null }, new Date())).toThrow(/No load profile to export/)
  })

  it('workbook: summary figures, monthly rows, bill lines and the 8 760-hour sheet', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await buildLoadProfileWorkbook(model) as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Monthly', 'TOU split', 'Bill lines', 'Average day', 'Load duration', 'Sources', 'Hourly'])
    const summary = wb.getWorksheet('Summary')!
    const annual = summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === 'Annual energy')!
    expect(annual.getCell(2).value).toBe(87_600)
    const monthly = wb.getWorksheet('Monthly')!
    expect(monthly.getRow(4).values).toEqual([undefined, 'Jan', 7440, 10.5, '2025-01-01 01:00', 0, 0, 7440, 14880, 17112]) // R2.00/kWh; +15 % VAT
    expect(wb.getWorksheet('Hourly')!.rowCount).toBe(3 + 8760)
  })

  it('PDF: renders, carries the figures, and no character outside WinAnsi survives', async () => {
    const buf = await renderLoadProfilePdf(model)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    const text = pdfText(buf)
    expect(text).toContain('87 600')
    expect(text).toContain('Mall Ohm')
    expect(text).toContain('Flat <= 100 kVA')
    expect(text).toContain('kWh per 60 min × 1 -> average kW')
    expect(text).not.toMatch(/[’Ð©]/) // the glyphs react-pdf substitutes for →, ◐, Ω
  })

  it('formats numbers space-grouped', () => {
    expect(fmtCell(1234567.8)).toBe('1 234 567.8')
    expect(fmtCell(-1200)).toBe('-1 200')
    expect(fmtCell(null)).toBe('')
  })
})
