/**
 * Feasibility and technical report content (functional spec §9.1) built ONLY from a stored run's
 * outputs (and, for feasibility, its stored financial result). Nothing is recomputed. The technical
 * report carries no rand value: money is dropped at the top, whatever the caller passes.
 */
import type { CaseRunOutputs } from '../cases/outputs'
import { CAPEX_CATEGORY_LABELS, type CapexTotals } from '../cases/finance-config'
import type { FinanceResult } from '../../services/solar/finance/cashflow'
import type { Tornado } from '../../services/solar/finance/sensitivity'
import type { Year1Bills } from '../../services/solar/finance/bill-calculator'
import { fixed, isoDate, kw, kwp, mwh, pct, years, zar } from './fmt'

export type SolarReportKind = 'feasibility' | 'technical'
export interface ReportTable { columns: string[]; rows: string[][]; numeric: boolean[] }
export interface ReportSection { title: string; paragraphs: string[]; tables: ReportTable[] }
export interface SolarReportModel {
  kind: SolarReportKind
  title: string
  kicker: string
  sections: ReportSection[]
  summary: Record<string, number | string>
}
export interface SolarReportMoney { capex: CapexTotals; year1Bills: Year1Bills; finance: FinanceResult; tornado: Tornado; tariffName: string | null }
export interface SolarReportInput {
  kind: SolarReportKind
  projectName: string
  address: string | null
  site: { latitude: number | null; longitude: number | null; licenseeName: string | null; nmdKva: number | null; exportMode: string | null; exportLimitKw: number | null }
  caseName: string
  run: { id: string; finishedAt: string; outputs: CaseRunOutputs }
  money: SolarReportMoney | null
  options: { layoutSheetAttached: boolean; include8760: boolean }
  disclaimer: string
  generatedAt: string
}

export const REPORT_DISCLAIMER_BASE =
  'Figures are modelled from the stored run named in this report, using a typical meteorological year and, where shown, ' +
  'the tariff named. Actual generation and savings will differ with weather, consumption, equipment performance and tariff ' +
  'changes. Rand values exclude VAT unless marked.'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MODEL_LABELS: Record<string, string> = { cash: 'Cash', debt: 'Debt-financed', ppa: 'PPA', lease: 'Lease' }
const TORNADO_LABELS: Record<string, string> = { capex: 'Capex', tariffEscalation: 'Tariff escalation', yield: 'Yield', discountRate: 'Discount rate', exportRate: 'Export rate' }
const EXPORT_LABELS: Record<string, string> = { net_billing: 'Net billing (export credited)', no_credit: 'Export allowed, no credit', zero_export: 'Zero export' }
const n1 = (v: number) => fixed(v, 1)
const table = (columns: string[], rows: string[][], numericFrom = 1): ReportTable => ({ columns, rows, numeric: columns.map((_, i) => i >= numericFrom) })

export function buildSolarReportModel(i: SolarReportInput): SolarReportModel {
  const money = i.kind === 'feasibility' ? i.money : null
  if (i.kind === 'feasibility' && !money) throw new Error('a feasibility report needs stored financial results')
  const o = i.run.outputs
  const k = o.kpis
  const battery = k.batteryKwh === null ? 'no battery' : `a ${n1(k.batteryKwh)} kWh / ${kw(k.batteryKw ?? 0)} battery`
  const sections: ReportSection[] = []

  // 1. Executive summary
  const summaryParas = [
    `${i.caseName}: ${kwp(k.dcKwp)} DC / ${kw(k.acKw)} AC with ${battery}, producing ${mwh(k.annualAcKwh)} in year 1 ` +
    `(${fixed(k.specificYieldKwhPerKwp, 0)} kWh/kWp) and supplying ${pct(k.solarFraction)} of the site's consumption.`,
  ]
  const kpiRows: string[][] = [
    ['PV size', `${kwp(k.dcKwp)} DC / ${kw(k.acKw)} AC`],
    ['Battery', k.batteryKwh === null ? 'None' : `${n1(k.batteryKwh)} kWh / ${kw(k.batteryKw ?? 0)}`],
    ['Year-1 PV yield', `${mwh(k.annualAcKwh)} (${fixed(k.specificYieldKwhPerKwp, 0)} kWh/kWp)`],
    ['Self-consumption', pct(k.selfConsumption)],
    ['Solar fraction of load', pct(k.solarFraction)],
    ['Export', mwh(k.exportKwh)],
  ]
  let firstView: FinanceResult['models'][number]['views'][number] | undefined
  if (money) {
    const b = money.year1Bills
    firstView = money.finance.models[0]?.views[0]
    summaryParas.push(`Year-1 electricity cost falls from ${zar(b.beforeZar)} to ${zar(b.afterZar)} (excl. VAT), a saving of ${zar(b.beforeZar - b.afterZar)}.`)
    kpiRows.push(
      ['Year-1 bill before / after (excl. VAT)', `${zar(b.beforeZar)} / ${zar(b.afterZar)}`],
      ['Year-1 saving', zar(b.beforeZar - b.afterZar)],
      ['Simple payback', years(firstView?.simplePaybackYears ?? null)],
      ['IRR', pct(firstView?.irr ?? null)],
      ['NPV', firstView ? zar(firstView.npvZar) : 'n/a'],
      ['LCOE', money.finance.lcoeZarPerKwh === null ? 'n/a' : `R ${fixed(money.finance.lcoeZarPerKwh, 2)}/kWh`],
    )
  }
  sections.push({ title: 'Executive summary', paragraphs: summaryParas, tables: [table(['Metric', 'Value'], kpiRows)] })

  // 2. Site and supply
  const s = i.site
  sections.push({
    title: 'Site and supply', paragraphs: [],
    tables: [table(['Item', 'Value'], [
      ['Project', i.projectName],
      ['Address', i.address ?? 'Not recorded'],
      ['Coordinates', s.latitude === null || s.longitude === null ? 'Not recorded' : `${fixed(s.latitude, 5)}, ${fixed(s.longitude, 5)}`],
      ['Supply authority', s.licenseeName ?? 'Not recorded'],
      ['Notified maximum demand', s.nmdKva === null ? 'Not recorded' : `${n1(s.nmdKva)} kVA`],
      ['Export rule', s.exportMode ? `${EXPORT_LABELS[s.exportMode] ?? s.exportMode}${s.exportLimitKw !== null ? `, limit ${kw(s.exportLimitKw)}` : ''}` : 'Not recorded'],
    ])],
  })

  // 3. Load analysis
  sections.push({
    title: 'Load analysis',
    paragraphs: [`Annual consumption ${mwh(k.loadKwh)}; peak demand ${kw(k.peakDemandBeforeKw)} before and ${kw(k.peakDemandAfterKw)} after solar (hourly basis). Load basis: ${o.provenance.loadBasis}, reference year ${o.provenance.loadReferenceYear}.`],
    tables: [table(['Month', 'Load (MWh)', 'PV (MWh)', 'Import before (MWh)', 'Import after (MWh)', 'Export (MWh)', 'Max demand before (kW)', 'Max demand after (kW)'],
      o.monthly.map((m, idx) => [MONTHS[idx] ?? String(m.month), n1(m.loadKwh / 1000), n1(m.pvKwh / 1000), n1(m.importBeforeKwh / 1000), n1(m.importKwh / 1000), n1(m.exportKwh / 1000), n1(m.maxDemandBeforeKw), n1(m.maxDemandAfterKw)]))],
  })

  // 4. Tariff (money)
  if (money) {
    const b = money.year1Bills
    sections.push({
      title: 'Tariff', paragraphs: [`Tariff: ${money.tariffName ?? 'as pinned on the Tariff tab'}.`],
      tables: [table(['Year-1 bill (excl. VAT)', 'Value'], [
        ['Without solar', zar(b.beforeZar)], ['With PV only', zar(b.afterPvOnlyZar)],
        ['With PV and battery', zar(b.afterZar)], ['Export credit used', zar(b.exportCreditUsedZar)],
      ])],
    })
  }

  // 5. System design
  sections.push({
    title: 'System design',
    paragraphs: i.options.layoutSheetAttached ? ['The PV layout sheet is attached at the end of this report.'] : [],
    tables: [table(['Item', 'Value'], [
      ['DC capacity', kwp(k.dcKwp)], ['AC capacity', kw(k.acKw)],
      ['DC/AC ratio', k.acKw > 0 ? fixed(k.dcKwp / k.acKw, 2) : 'n/a'],
      ['Battery', k.batteryKwh === null ? 'None' : `${n1(k.batteryKwh)} kWh / ${kw(k.batteryKw ?? 0)}`],
      ['Performance ratio', pct(k.performanceRatio)],
    ])],
  })

  // 6. Yield
  sections.push({
    title: 'Yield', paragraphs: [],
    tables: [
      table(['Energy flow', 'kWh'], o.waterfall.map((w) => [w.label, fixed(w.kwh, 0)])),
      table(['Check', 'Status', 'Detail'], o.checks.map((c) => [c.label, c.status === 'n/a' ? 'Not applicable' : c.status.charAt(0).toUpperCase() + c.status.slice(1), c.detail]), 99),
    ],
  })

  // 7-8. Financials and sensitivity (money)
  if (money) {
    const c = money.capex
    const capexRows = Object.entries(c.byCategory)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .map(([cat, v]) => [CAPEX_CATEGORY_LABELS[cat as keyof typeof CAPEX_CATEGORY_LABELS] ?? cat, zar(v as number)])
    capexRows.push(['Total (excl. VAT)', zar(c.exclVatZar)], ['VAT', zar(c.vatZar)], ['Total (incl. VAT)', zar(c.inclVatZar)],
      ['Cost per watt (DC)', c.zarPerWp === null ? 'n/a' : `R ${fixed(c.zarPerWp, 2)}/Wp`])
    const modelRows = money.finance.models.flatMap((m) => m.views.map((v) => [
      MODEL_LABELS[m.model] ?? m.model, v.view, zar(v.upfrontZar), zar(v.npvZar), pct(v.irr), years(v.simplePaybackYears), years(v.discountedPaybackYears),
    ]))
    const cf = firstView ? firstView.rows.map((r) => [String(r.year), zar(r.savingZar), zar(r.opexZar), zar(r.replacementZar), zar(r.financeZar), zar(r.taxZar), zar(r.netZar), zar(r.cumulativeZar)]) : []
    const ls = money.finance.loadShedding
    sections.push({
      title: 'Financials',
      paragraphs: [
        `LCOE ${money.finance.lcoeZarPerKwh === null ? 'n/a' : `R ${fixed(money.finance.lcoeZarPerKwh, 2)}/kWh`}.`,
        ...(ls ? [`Load-shedding value (NPV ${zar(ls.npvZar)}) is reported separately and not included in any cashflow or IRR.`] : []),
      ],
      tables: [
        table(['Capex', 'Amount'], capexRows),
        table(['Model', 'View', 'Upfront', 'NPV', 'IRR', 'Simple payback', 'Discounted payback'], modelRows, 2),
        table(['Year', 'Saving', 'Opex', 'Replacements', 'Finance', 'Tax', 'Net', 'Cumulative'], cf),
      ],
    })
    sections.push({
      title: 'Sensitivity',
      paragraphs: [`NPV of the ${MODEL_LABELS[money.tornado.model] ?? money.tornado.model} (${money.tornado.view}) case at plus or minus ${fixed(money.tornado.swing * 100, 0)} % of each input. Base NPV ${zar(money.tornado.baseNpvZar)}.`],
      tables: [table(['Input', 'NPV low', 'NPV high', 'Spread'], money.tornado.bars.map((b) => [TORNADO_LABELS[b.variable] ?? b.variable, zar(b.lowNpvZar), zar(b.highNpvZar), zar(b.spreadZar)]))],
    })
  }

  // 9. Assumptions and provenance
  const p = o.provenance
  sections.push({
    title: 'Assumptions and provenance',
    paragraphs: i.options.include8760
      ? [`Hourly data (8 760 rows) for run ${i.run.id} is available as CSV from Yield and Scenarios, Export hourly.`]
      : [],
    tables: [table(['Item', 'Value'], [
      ['Case', i.caseName], ['Run', i.run.id], ['Run completed', isoDate(i.run.finishedAt)],
      ['Engine version', p.engineVersion], ['Inputs hash', p.inputsHash],
      ['Weather', `${p.weatherSource}${p.weatherFetchedAt ? `, fetched ${isoDate(p.weatherFetchedAt)}` : ''}`],
      ['Global Solar Atlas PVOUT', p.gsaPvoutKwhPerKwp === null ? 'n/a' : `${fixed(p.gsaPvoutKwhPerKwp, 0)} kWh/kWp`],
      ...(money && p.tariffRef ? [['Tariff', `${p.tariffRef.tariffName} (${p.tariffRef.licenseeName}, ${p.tariffRef.financialYear})`]] : []),
      ['Report generated', isoDate(i.generatedAt)],
    ], 99)],
  })

  // 10. Disclaimers
  sections.push({ title: 'Disclaimers', paragraphs: [REPORT_DISCLAIMER_BASE, ...(i.disclaimer.trim() ? [i.disclaimer.trim()] : [])], tables: [] })

  const summary: Record<string, number | string> = { kwp: Math.round(k.dcKwp * 10) / 10, mwhYear1: Math.round(k.annualAcKwh / 100) / 10 }
  if (money) {
    summary.saving = zar(money.year1Bills.beforeZar - money.year1Bills.afterZar)
    summary.irrPct = firstView?.irr == null ? 'n/a' : Math.round(firstView.irr * 1000) / 10
  }
  summary.runId = i.run.id
  return {
    kind: i.kind,
    title: i.kind === 'feasibility' ? 'Solar PV feasibility report' : 'Solar PV technical report',
    kicker: i.kind === 'feasibility' ? 'SOLAR FEASIBILITY' : 'SOLAR TECHNICAL',
    sections, summary,
  }
}
