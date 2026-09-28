import 'server-only'
/**
 * Financials tab view model (functional spec §8). Every result figure is taken from the latest stored
 * solar.case_run_financials row (read under money RLS) and shaped here, server-side, so the browser only
 * formats. JSON only (a page.tsx hands this to client components). Callers must have passed
 * requireSolarLevel(project, 'edit_financials') — `svc` reads the study inputs and the org defaults.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings, solarOrgSettingDefaults } from '@esite/shared'
import {
  buildFinanceInput, caseStatus, defaultFinanceConfig, parseCaseConfig, parseFinanceConfig, VAT_RATE,
  type CaseFinanceConfig, type CaseRunOutputs,
} from '@esite/shared/solar-cases'
import { contextForCase, loadStudyInputs, type CaseRow } from './run-context'
import { runsByCase } from './page-data'
import { FIN_RUN_REASONS, finInputsHash } from './financials'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const MODEL_LABEL: Record<string, string> = { cash: 'Cash purchase', debt: 'Debt-financed', ppa: 'PPA', lease: 'Lease / rent-to-own' }
const TORNADO_LABEL: Record<string, string> = { capex: 'Capex', tariffEscalation: 'Tariff escalation', yield: 'Yield', discountRate: 'Discount rate', exportRate: 'Export rate' }

export interface CashflowRowView { year: number; energyKwh: number; billBeforeZar: number; billAfterZar: number; savingZar: number; opexZar: number; replacementZar: number; taxZar: number; financeZar: number; netZar: number; cumulativeZar: number }
export interface FinancialModelColumn {
  key: string; label: string
  /** This party's year-1 figure: owner = bill saving; PPA/lease client = saving − payments; investor = income. */
  year1: { label: 'Year-1 saving' | 'Year-1 net saving' | 'Year-1 income'; zar: number }
  upfrontZar: number; npvZar: number; irr: number | null
  simplePaybackYears: number | null; discountedPaybackYears: number | null; cumulativeZar: number; rows: CashflowRowView[]
}
export interface FinancialResultsView {
  computedAt: string; engineVersion: string; tariffLabel: string
  capex: { exclVatZar: number; vatZar: number; inclVatZar: number; zarPerWp: number | null }
  year1: { billBeforeZar: number; billAfterZar: number; savingZar: number; exportCreditUsedZar: number }
  lcoeZarPerKwh: number | null
  columns: FinancialModelColumn[]
  tornado: { title: string; baseNpvZar: number; bars: Array<{ variable: string; label: string; lowNpvZar: number; highNpvZar: number; spreadZar: number }> }
  loadShedding: { year1Zar: number; npvZar: number } | null
}
export interface FinancialsPageData {
  hasStudy: boolean
  cases: Array<{ id: string; name: string; hasRun: boolean }>
  caseId: string | null; caseName: string
  config: CaseFinanceConfig; configUpdatedAt: string | null; isDefault: boolean
  runSize: { dcKwp: number; acKw: number; batteryKwh: number | null } | null
  caseLoadSheddingEnabled: boolean
  runReasons: string[]; tariffReason: string | null
  energyStale: boolean; financialsStale: boolean
  results: FinancialResultsView | null
  vatRate: number
}

/** Stored case_run_financials row → display view. Year-1 saving = stored bill before − stored bill after. */
/** Year-1 figure for one model/view, from the engine's own first cashflow row (CashflowRow). */
function year1Of(view: string, rows: CashflowRowView[]): FinancialModelColumn['year1'] {
  const r = rows[0]
  const saving = r?.savingZar ?? 0, finance = r?.financeZar ?? 0
  if (view === 'investor') return { label: 'Year-1 income', zar: -finance }        // financeZar < 0 = received
  if (view === 'client') return { label: 'Year-1 net saving', zar: saving - finance } // PPA / lease payments paid
  return { label: 'Year-1 saving', zar: saving }
}

export function resultsView(row: Row): FinancialResultsView {
  const r = row.results
  const columns: FinancialModelColumn[] = ((r.finance?.models ?? []) as Row[]).flatMap((m) => ((m.views ?? []) as Row[]).map((v) => ({
    key: `${m.model}-${v.view}`, label: `${MODEL_LABEL[m.model] ?? m.model} — ${v.view}`, year1: year1Of(v.view, (v.rows ?? []) as CashflowRowView[]),
    upfrontZar: v.upfrontZar, npvZar: v.npvZar, irr: v.irr ?? null, simplePaybackYears: v.simplePaybackYears ?? null, discountedPaybackYears: v.discountedPaybackYears ?? null,
    cumulativeZar: (v.rows as CashflowRowView[]).at(-1)?.cumulativeZar ?? 0, rows: v.rows as CashflowRowView[],
  })))
  const t = row.tariff_ref ?? {}
  return {
    computedAt: row.created_at, engineVersion: row.engine_version,
    tariffLabel: `${t.licenseeName ?? ''} ${t.tariffName ?? ''} ${t.financialYear ?? ''}`.replace(/\s+/g, ' ').trim(),
    capex: { exclVatZar: r.capex.exclVatZar, vatZar: r.capex.vatZar, inclVatZar: r.capex.inclVatZar, zarPerWp: r.capex.zarPerWp ?? null },
    year1: { billBeforeZar: r.year1Bills.beforeZar, billAfterZar: r.year1Bills.afterZar, savingZar: r.year1Bills.beforeZar - r.year1Bills.afterZar, exportCreditUsedZar: r.year1Bills.exportCreditUsedZar },
    lcoeZarPerKwh: r.finance?.lcoeZarPerKwh ?? null,
    columns,
    tornado: {
      title: `NPV sensitivity (${MODEL_LABEL[r.tornado.model] ?? r.tornado.model} — ${r.tornado.view}), ±20 %`,
      baseNpvZar: r.tornado.baseNpvZar,
      bars: ((r.tornado.bars ?? []) as Row[]).map((b) => ({ variable: b.variable, label: TORNADO_LABEL[b.variable] ?? b.variable, lowNpvZar: b.lowNpvZar, highNpvZar: b.highNpvZar, spreadZar: b.spreadZar })),
    },
    loadShedding: r.finance?.loadShedding ? { year1Zar: r.finance.loadShedding.annualZar?.[0] ?? 0, npvZar: r.finance.loadShedding.npvZar } : null,
  }
}

export async function loadFinancialsPageData(user: AnyClient, svc: AnyClient, projectId: string, caseIdParam: string | undefined): Promise<FinancialsPageData> {
  const empty: FinancialsPageData = {
    hasStudy: false, cases: [], caseId: null, caseName: '', config: defaultFinanceConfig(solarOrgSettingDefaults()), configUpdatedAt: null, isDefault: true,
    runSize: null, caseLoadSheddingEnabled: false, runReasons: [], tariffReason: null, energyStale: false, financialsStale: false, results: null, vatRate: VAT_RATE,
  }
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return empty
  const { data: caseData } = await user.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at').eq('project_id', projectId)
  const rows = (caseData ?? []) as CaseRow[]
  const { latest, ok } = await runsByCase(user, projectId)
  const cases = rows.map((r) => ({ id: r.id, name: r.name, hasRun: ok.has(r.id) }))
  const caseId = [caseIdParam, shared.study.selected_case_id, cases.find((c) => c.hasRun)?.id, cases[0]?.id].find((id) => id && rows.some((r) => r.id === id)) ?? null
  if (!caseId) return { ...empty, hasStudy: true, cases }
  const row = rows.find((r) => r.id === caseId)!

  const { data: finRows } = await user.schema('solar').from('case_financials').select('config, updated_at').eq('case_id', caseId)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  const parsedFin = finRow ? parseFinanceConfig(finRow.config) : null
  let config: CaseFinanceConfig
  let isDefault = false
  if (parsedFin?.ok) config = parsedFin.fin
  else {
    const { data: os } = await svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', shared.study.organisation_id).maybeSingle()
    config = defaultFinanceConfig(readSolarOrgSettings((os as Row | null)?.settings ?? null))
    isDefault = true
  }

  const lastOkMeta = ok.get(caseId) ?? null
  let lastOk: Row | null = null
  if (lastOkMeta) {
    const { data } = await user.schema('solar').from('case_runs').select('id, config_snapshot, outputs').eq('id', lastOkMeta.id).maybeSingle()
    lastOk = (data as Row | null) ?? null
  }
  const kpis = (lastOk?.outputs as CaseRunOutputs | undefined)?.kpis
  const snap = lastOk ? parseCaseConfig(lastOk.config_snapshot) : null
  const runReasons: string[] = []
  let currentFinHash: string | null = null
  if (!lastOk || !kpis || !snap?.ok) runReasons.push(FIN_RUN_REASONS.noRun)
  else {
    const built = buildFinanceInput(config, snap.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw })
    if (!built.ok) runReasons.push(...built.reasons)
    else if (shared.tariff.ok) currentFinHash = finInputsHash(built.input, shared.tariff.tariffRef, lastOk.id)
  }
  if (isDefault && lastOk) runReasons.push(FIN_RUN_REASONS.noFinancials)

  const c = await contextForCase(svc, shared, row)
  const last = latest.get(caseId)
  const energyStale = caseStatus(last ? { status: last.status, inputsHash: last.inputs_hash, startedAt: last.started_at } : null,
    lastOkMeta ? { inputsHash: lastOkMeta.inputs_hash } : null, c.ok ? c.ctx.currentHash : null, Date.now()).status === 'stale'

  const { data: resRows } = await user.schema('solar').from('case_run_financials').select('case_id, case_run_id, created_at, engine_version, tariff_ref, fin_inputs_hash, results')
    .eq('case_id', caseId).order('created_at', { ascending: false }).limit(1)
  const res = Array.isArray(resRows) ? (resRows[0] as Row | undefined) : undefined
  // Stale when priced on an older run, or on a finance input / tariff that differs from the saved one now.
  const financialsStale = Boolean(res) && (res!.case_run_id !== lastOk?.id || (currentFinHash !== null && res!.fin_inputs_hash !== currentFinHash))
  const caseCfg = parseCaseConfig(row.config)

  return {
    hasStudy: true, cases, caseId, caseName: row.name,
    config, configUpdatedAt: parsedFin?.ok ? (finRow!.updated_at as string) : null, isDefault,
    runSize: kpis ? { dcKwp: kpis.dcKwp, acKw: kpis.acKw, batteryKwh: kpis.batteryKwh ?? null } : null,
    caseLoadSheddingEnabled: caseCfg.ok ? caseCfg.config.loadShedding.enabled : false,
    runReasons, tariffReason: shared.tariff.ok ? null : shared.tariff.reason,
    energyStale, financialsStale,
    results: res ? resultsView(res) : null,
    vatRate: VAT_RATE,
  }
}
