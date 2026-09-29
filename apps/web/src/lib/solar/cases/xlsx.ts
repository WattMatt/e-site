import 'server-only'
/** Download XLSX (functional spec §8): every assumption + the year table per finance model/view, from the STORED result. */
import ExcelJS from 'exceljs'

type Json = Record<string, unknown>
const MODEL_LABEL: Record<string, string> = { cash: 'Cash', debt: 'Debt', ppa: 'PPA', lease: 'Lease' }
const TORNADO_LABEL: Record<string, string> = { capex: 'Capex', tariffEscalation: 'Tariff escalation', yield: 'Yield', discountRate: 'Discount rate', exportRate: 'Export rate' }

function flatten(o: unknown, prefix = ''): Array<[string, string | number | boolean | null]> {
  if (o === null || typeof o !== 'object') return [[prefix, o as string | number | boolean | null]]
  if (Array.isArray(o)) return [[prefix, JSON.stringify(o)]]
  return Object.entries(o as Json).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
}

export interface FinancialsWorkbookRow { created_at: string; engine_version: string; tariff_ref: Json; fin_inputs: Json; results: Json }
export interface FinancialsWorkbookCapexLine { category: string; description: string; qty: number; unit: string; rateZar: number }

export async function buildFinancialsWorkbook(a: {
  projectName: string; caseName: string
  row: FinancialsWorkbookRow
  capexLines: FinancialsWorkbookCapexLine[]
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site Solar'
  const r = a.row.results as any // eslint-disable-line @typescript-eslint/no-explicit-any

  const as = wb.addWorksheet('Assumptions')
  as.columns = [{ header: 'Assumption', key: 'k', width: 42 }, { header: 'Value', key: 'v', width: 28 }]
  as.addRow({ k: 'Project', v: a.projectName })
  as.addRow({ k: 'Case', v: a.caseName })
  as.addRow({ k: 'Computed at', v: a.row.created_at })
  as.addRow({ k: 'Engine version', v: a.row.engine_version })
  const t = a.row.tariff_ref as { tariffName?: string; financialYear?: string; licenseeName?: string }
  as.addRow({ k: 'Tariff', v: `${t.licenseeName ?? ''} — ${t.tariffName ?? ''} (${t.financialYear ?? ''})` })
  as.addRow({ k: 'Year-1 bill before (R excl. VAT)', v: r.year1Bills?.beforeZar ?? null })
  as.addRow({ k: 'Year-1 bill after (R excl. VAT)', v: r.year1Bills?.afterZar ?? null })
  as.addRow({ k: 'LCOE (R/kWh)', v: r.finance?.lcoeZarPerKwh ?? null })
  for (const [k, v] of flatten((a.row.fin_inputs as Json).config)) as.addRow({ k, v })

  const cx = wb.addWorksheet('Capex')
  cx.columns = [{ header: 'Category', key: 'c', width: 24 }, { header: 'Description', key: 'd', width: 40 }, { header: 'Qty', key: 'q', width: 12 }, { header: 'Unit', key: 'u', width: 8 }, { header: 'Rate (R)', key: 'r', width: 14 }, { header: 'Amount (R excl. VAT)', key: 'a', width: 20 }]
  for (const l of a.capexLines) cx.addRow({ c: l.category, d: l.description, q: l.qty, u: l.unit, r: l.rateZar, a: l.qty * l.rateZar })
  cx.addRow({})
  cx.addRow({ d: 'Total excl. VAT', a: r.capex?.exclVatZar ?? null })
  cx.addRow({ d: 'VAT', a: r.capex?.vatZar ?? null })
  cx.addRow({ d: 'Total incl. VAT', a: r.capex?.inclVatZar ?? null })
  cx.addRow({ d: 'R/Wp (capex ÷ DC Wp)', a: r.capex?.zarPerWp ?? null })

  for (const m of r.finance?.models ?? []) {
    for (const v of m.views) {
      const ws = wb.addWorksheet(`${MODEL_LABEL[m.model] ?? m.model} - ${v.view}`.slice(0, 31))
      // Column A holds nothing; the year table starts in column B, KPIs below it.
      ws.addRow([undefined, 'Year', 'Energy (kWh)', 'Bill before (R)', 'Bill after (R)', 'Saving (R)', 'Opex (R)', 'Replacements (R)', 'Tax (R)', 'Finance (R)', 'Net (R)', 'Cumulative (R)'])
      for (let c = 2; c <= 12; c++) ws.getColumn(c).width = 16
      for (const row of v.rows) ws.addRow([undefined, row.year, row.energyKwh, row.billBeforeZar, row.billAfterZar, row.savingZar, row.opexZar, row.replacementZar, row.taxZar, row.financeZar, row.netZar, row.cumulativeZar])
      ws.addRow([])
      ws.addRow([undefined, 'NPV (R)', v.npvZar])
      ws.addRow([undefined, 'IRR', v.irr])
      ws.addRow([undefined, 'Simple payback (years)', v.simplePaybackYears])
      ws.addRow([undefined, 'Discounted payback (years)', v.discountedPaybackYears])
    }
  }

  const sn = wb.addWorksheet('Sensitivity')
  sn.columns = [{ header: 'Variable (±20 %)', width: 22 }, { header: 'NPV at −20 % (R)', width: 18 }, { header: 'NPV at +20 % (R)', width: 18 }, { header: 'Spread (R)', width: 16 }]
  for (const b of r.tornado?.bars ?? []) sn.addRow([TORNADO_LABEL[b.variable] ?? b.variable, b.lowNpvZar, b.highNpvZar, b.spreadZar])

  return Buffer.from(await wb.xlsx.writeBuffer())
}
