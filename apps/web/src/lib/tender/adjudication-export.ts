import ExcelJS from 'exceljs'
import type { Adjudication, AdjCompliance } from './adjudication'

const MONEY = '# ##0.00'
const FILL = {
  high: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE2E1' } },
  low: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } },
  zero: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } },
  head: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF4' } },
} as const

/**
 * Text that came from a bidder (company names, file names) is written as text,
 * never as something a spreadsheet could evaluate: a leading = + - @ is
 * escaped with an apostrophe so a later re-save or CSV export stays inert.
 */
export function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

const cents = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))
/** VAT at 15 %, in cents, so excl. + VAT always equals incl. */
function vat(total: number) {
  const c = cents(total)
  const v = Math.round(c * 0.15)
  return { vat: v / 100, incl: (c + v) / 100 }
}

function header(ws: ExcelJS.Worksheet, values: (string | number)[]) {
  const row = ws.addRow(values)
  row.font = { bold: true }
  row.eachCell((c) => { c.fill = FILL.head as ExcelJS.Fill })
  return row
}

/** Column headings per bidder, made unique when two companies share a name. */
function bidderLabels(a: Adjudication): Record<string, string> {
  const seen = new Map<string, number>()
  const out: Record<string, string> = {}
  for (const t of a.totals) {
    const n = (seen.get(t.company) ?? 0) + 1
    seen.set(t.company, n)
    out[t.participantId] = safeText(n > 1 ? `${t.company} (${n})` : t.company)
  }
  return out
}

/**
 * Adjudication workbook: Summary (ranked totals, by bill, vs estimate, CIDB and
 * B-BBEE), Comparison (every item: estimate, median and each bidder's rate and
 * amount, outliers shaded), Checklist (documents and declarations per bidder),
 * Flags (what to query per bidder) and Arithmetic (errors in WM's estimate).
 */
export async function buildAdjudicationWorkbook(
  a: Adjudication,
  meta: { project: string; tender: string; closedAt: string | null; profiles?: Record<string, AdjCompliance['profile']> },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site'
  const bidders = a.totals // already ranked
  const label = bidderLabels(a)
  const pct = Math.round(a.threshold * 100)

  const s = wb.addWorksheet('Summary')
  s.addRow([safeText(`Tender adjudication — ${meta.tender}`)]).font = { bold: true, size: 14 }
  s.addRow([safeText(meta.project)])
  s.addRow([meta.closedAt ? `Closed ${new Date(meta.closedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}` : ''])
  s.addRow([`Amounts are recalculated from the issued quantities × each rate, for the bids and for WM's estimate; fixed sums are included as issued. Flags: more than ${pct} % from WM's estimate rate, or (with three or more bids) from the median rate.`])
  s.addRow([])
  header(s, ['Rank', 'Company', 'Submitted', 'Total excl. VAT', 'VAT 15 %', 'Total incl. VAT', 'vs estimate %', 'CIDB grade', 'B-BBEE level', ...a.bills.map((b) => `Bill ${b}`)])
  const moneyCols = [4, 5, 6, ...a.bills.map((_, i) => 10 + i)]
  for (const t of bidders) {
    const v = vat(t.total)
    const p = meta.profiles?.[t.participantId] ?? null
    const r = s.addRow([
      t.rank, label[t.participantId], t.submittedAt ? new Date(t.submittedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '',
      t.total, v.vat, v.incl, t.vsEstimatePct ?? '', safeText(p?.cidb_grade ?? ''), safeText(p?.bbbee_level ?? ''),
      ...a.bills.map((b) => t.byBill[b] ?? 0),
    ])
    moneyCols.forEach((c) => (r.getCell(c).numFmt = MONEY))
  }
  if (a.estimateMissing > 0) {
    s.addRow(['', `WM estimate: incomplete (no rate for ${a.estimateMissing} priced item(s)), so no total is shown.`]).font = { italic: true }
  }
  if (a.estimateTotal != null) {
    const v = vat(a.estimateTotal)
    const r = s.addRow(['', 'WM estimate', '', a.estimateTotal, v.vat, v.incl, '', '', '', ...a.bills.map((b) => a.estimateByBill[b] ?? 0)])
    r.font = { italic: true }
    moneyCols.forEach((c) => (r.getCell(c).numFmt = MONEY))
  }
  s.columns.forEach((c, i) => (c.width = i === 1 ? 34 : 16))

  const c = wb.addWorksheet('Comparison')
  header(c, ['Sheet', 'Item', 'Description', 'Unit', 'Qty', 'Estimate rate', 'Estimate amount', 'Median rate', ...bidders.flatMap((t) => [`${label[t.participantId]} rate`, `${label[t.participantId]} amount`])])
  for (const row of a.rows) {
    const values: (string | number | null)[] = [
      row.item.sheet_name, row.item.code ?? '', row.item.description, row.item.unit ?? '', row.item.quantity ?? '',
      row.item.rate_cell_type === 'fixed' ? 'fixed' : row.estimate?.rate ?? '',
      row.item.rate_cell_type === 'fixed' ? Number(row.item.fixed_amount ?? 0) : row.estimate?.amount ?? '',
      row.medianRate ?? '',
    ]
    for (const t of bidders) {
      const cell = row.bids[t.participantId]
      values.push(cell.rate ?? (cell.flag === 'not_priced' ? 'not priced' : ''), cell.amount)
    }
    const r = c.addRow(values)
    ;[6, 7, 8].forEach((i) => (r.getCell(i).numFmt = MONEY))
    bidders.forEach((t, i) => {
      const cell = row.bids[t.participantId]
      const rateCell = r.getCell(9 + i * 2)
      const amountCell = r.getCell(10 + i * 2)
      amountCell.numFmt = MONEY
      if (typeof rateCell.value === 'number') rateCell.numFmt = MONEY
      if (cell.flag === 'high' || cell.flag === 'low' || cell.flag === 'zero') rateCell.fill = FILL[cell.flag] as ExcelJS.Fill
      else if (cell.vsEstimate === 'above') rateCell.fill = FILL.high as ExcelJS.Fill
      else if (cell.vsEstimate === 'below') rateCell.fill = FILL.low as ExcelJS.Fill
      const notes = [
        cell.flag === 'high' ? `more than ${pct} % above the median` : cell.flag === 'low' ? `more than ${pct} % below the median` : cell.flag === 'zero' ? 'zero rate' : null,
        cell.vsEstimate === 'above' ? `more than ${pct} % above WM's estimate` : cell.vsEstimate === 'below' ? `more than ${pct} % below WM's estimate` : null,
      ].filter(Boolean)
      if (notes.length) rateCell.note = notes.join('; ')
    })
  }
  c.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }]
  c.getColumn(3).width = 50

  const k = wb.addWorksheet('Checklist')
  header(k, ['Requirement', 'Kind', 'Required', ...bidders.map((t) => label[t.participantId])])
  for (const item of a.checklist) {
    k.addRow([
      item.requirement.label, item.requirement.kind, item.requirement.mandatory ? 'yes' : 'no',
      ...bidders.map((t) => {
        const x = item.byBidder[t.participantId]
        return `${x?.ok ? 'yes' : 'NO'}: ${safeText(x?.detail ?? '')}`
      }),
    ])
  }
  k.getColumn(1).width = 40

  const f = wb.addWorksheet('Flags')
  header(f, ['Company', `Above estimate (> ${pct} %)`, `Below estimate (> ${pct} %)`, 'Above median', 'Below median', 'Zero rates', 'Marked not priced'])
  for (const t of bidders) {
    f.addRow([label[t.participantId], t.flags.aboveEstimate, t.flags.belowEstimate, t.flags.high, t.flags.low, t.flags.zero, t.flags.notPriced])
  }
  f.getColumn(1).width = 34

  const ar = wb.addWorksheet('Arithmetic')
  ar.addRow(['Bids priced in the portal carry no extension errors: every amount is quantity × rate, computed by the database. Listed here: lines in WM\'s estimate whose stated amount differs from quantity × rate.'])
  header(ar, ['Sheet', 'Row', 'Item', 'Description', 'Stated amount', 'Quantity × rate', 'Difference'])
  if (a.arithmetic.estimate.length === 0) ar.addRow(['None found.'])
  for (const x of a.arithmetic.estimate) {
    const r = ar.addRow([x.sheet, x.rowNumber, x.code ?? '', x.description, x.stated, x.computed, cents(x.stated - x.computed) / 100])
    ;[5, 6, 7].forEach((i) => (r.getCell(i).numFmt = MONEY))
  }
  ar.getColumn(4).width = 50

  return Buffer.from(await wb.xlsx.writeBuffer())
}
