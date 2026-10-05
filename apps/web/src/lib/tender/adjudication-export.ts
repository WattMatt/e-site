import ExcelJS from 'exceljs'
import type { Adjudication } from './adjudication'

const MONEY = '# ##0.00'
const FILL = {
  high: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE2E1' } },
  low: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } },
  zero: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } },
  head: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF4' } },
} as const

function header(ws: ExcelJS.Worksheet, values: (string | number)[]) {
  const row = ws.addRow(values)
  row.font = { bold: true }
  row.eachCell((c) => { c.fill = FILL.head as ExcelJS.Fill })
  return row
}

/**
 * Adjudication workbook: Summary (ranked totals, by bill, vs estimate), Comparison
 * (every item: estimate and each bidder's rate and amount, outliers shaded),
 * Checklist (documents and declarations per bidder) and Flags (what to query).
 */
export async function buildAdjudicationWorkbook(a: Adjudication, meta: { project: string; tender: string; closedAt: string | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site'
  const bidders = a.totals // already ranked

  const s = wb.addWorksheet('Summary')
  s.addRow([`Tender adjudication — ${meta.tender}`]).font = { bold: true, size: 14 }
  s.addRow([meta.project])
  s.addRow([meta.closedAt ? `Closed ${new Date(meta.closedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}` : ''])
  s.addRow([`Amounts are recalculated from the issued quantities × each bidder's rates; fixed sums are included as issued. Outliers: more than ${Math.round(a.threshold * 100)} % from the median rate.`])
  s.addRow([])
  header(s, ['Rank', 'Company', 'Submitted', 'Total excl. VAT', 'VAT 15 %', 'Total incl. VAT', 'vs estimate %', ...a.bills.map((b) => `Bill ${b}`)])
  for (const t of bidders) {
    const r = s.addRow([
      t.rank, t.company, t.submittedAt ? new Date(t.submittedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '',
      t.total, Math.round(t.total * 15) / 100, Math.round(t.total * 115) / 100, t.vsEstimatePct ?? '',
      ...a.bills.map((b) => t.byBill[b] ?? 0),
    ])
    ;[4, 5, 6, ...a.bills.map((_, i) => 8 + i)].forEach((c) => (r.getCell(c).numFmt = MONEY))
  }
  if (a.estimateTotal != null) {
    const r = s.addRow(['', 'WM estimate', '', a.estimateTotal, Math.round(a.estimateTotal * 15) / 100, Math.round(a.estimateTotal * 115) / 100, '', ...a.bills.map((b) => a.estimateByBill[b] ?? 0)])
    r.font = { italic: true }
    ;[4, 5, 6, ...a.bills.map((_, i) => 8 + i)].forEach((c) => (r.getCell(c).numFmt = MONEY))
  }
  s.columns.forEach((c, i) => (c.width = i === 1 ? 34 : 16))

  const c = wb.addWorksheet('Comparison')
  header(c, ['Sheet', 'Item', 'Description', 'Unit', 'Qty', 'Estimate rate', 'Estimate amount', 'Median rate', ...bidders.flatMap((t) => [`${t.company} rate`, `${t.company} amount`])])
  for (const row of a.rows) {
    const values: (string | number | null)[] = [
      row.item.sheet_name, row.item.code ?? '', row.item.description, row.item.unit ?? '', row.item.quantity ?? '',
      row.item.rate_cell_type === 'fixed' ? 'fixed' : row.estimate?.rate ?? '',
      row.item.rate_cell_type === 'fixed' ? Number(row.item.fixed_amount ?? 0) : row.estimate?.amount ?? '',
      row.medianRate ?? '',
    ]
    for (const t of bidders) {
      const cell = row.bids[t.participantId]
      values.push(cell.rate ?? (cell.flag === 'not_priced' ? 'not priced' : cell.flag === 'unpriced' ? 'unpriced' : ''), cell.amount)
    }
    const r = c.addRow(values)
    ;[6, 7, 8].forEach((i) => (r.getCell(i).numFmt = MONEY))
    bidders.forEach((t, i) => {
      const flag = row.bids[t.participantId].flag
      const rateCell = r.getCell(9 + i * 2)
      const amountCell = r.getCell(10 + i * 2)
      amountCell.numFmt = MONEY
      if (typeof rateCell.value === 'number') rateCell.numFmt = MONEY
      if (flag === 'high' || flag === 'low' || flag === 'zero') rateCell.fill = FILL[flag] as ExcelJS.Fill
    })
  }
  c.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }]
  c.getColumn(3).width = 50

  const k = wb.addWorksheet('Checklist')
  header(k, ['Requirement', 'Kind', 'Required', ...bidders.map((t) => t.company)])
  for (const item of a.checklist) {
    k.addRow([
      item.requirement.label, item.requirement.kind, item.requirement.mandatory ? 'yes' : 'no',
      ...bidders.map((t) => `${item.byBidder[t.participantId]?.ok ? '✔' : '✘'} ${item.byBidder[t.participantId]?.detail ?? ''}`),
    ])
  }
  k.getColumn(1).width = 40

  const f = wb.addWorksheet('Flags')
  header(f, ['Company', 'Rates far above median', 'Rates far below median', 'Zero rates', 'Unpriced items', 'Marked not priced'])
  for (const t of bidders) f.addRow([t.company, t.flags.high, t.flags.low, t.flags.zero, t.flags.unpriced, t.flags.notPriced])
  f.getColumn(1).width = 34

  return Buffer.from(await wb.xlsx.writeBuffer())
}
