import 'server-only'
/**
 * Run financials (functional spec §8): pure computation on the STORED run — the latest succeeded run's
 * hourly CSV and KPIs, the case config snapshot the run used, the saved financials and the study's
 * tariff. Every read of the saved financials goes through the caller's session (money RLS — the DB half
 * of the edit_financials gate); the immutable solar.case_run_financials row is written by the SERVICE
 * client with run_by set explicitly (00215: authenticated has no INSERT there, so a money user cannot
 * post figures of their own over PostgREST). Call only AFTER the action's edit_financials gate.
 * The tariff is priced on the run's stored load reference year (provenance.loadReferenceYear), the
 * same year the run's load was aligned to.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, inputsHash } from '@esite/shared/solar-engine'
import { buildFinanceInput, capexTotals, financeInputReasons, decodeHourlyCsv, parseCaseConfig, parseFinanceConfig, runStoredFinancials, type CaseRunOutputs } from '@esite/shared/solar-cases'
import { humanSolarError } from '@/lib/solar/errors'
import { resolveStudyTariff } from './tariff'
import { getGzipText, RUNS_BUCKET } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const FIN_RUN_REASONS = {
  noRun: 'Run the case on Yield & Scenarios first.',
  noFinancials: 'Save the financials first.',
  badFinancials: 'The saved financials are invalid — review each section and save again.',
  badRun: 'The run’s stored configuration could not be read — re-run the case.',
  fileMissing: 'The stored hourly file for this run is missing — re-run the case.',
  computeFailed: 'Financials could not be computed from these inputs — check each Financials section and save again.',
} as const

export type FinRunOutcome = { ok: true; id: string } | { ok: false; status: number; error: string }

export async function latestSucceededRun(user: AnyClient, projectId: string, caseId: string): Promise<Row | null> {
  const { data } = await user.schema('solar').from('case_runs').select('id, case_id, status, hourly_path, config_snapshot, outputs, started_at, export_settings:inputs->export')
    .eq('case_id', caseId).eq('project_id', projectId).eq('status', 'succeeded').order('started_at', { ascending: false }).limit(1)
  return (Array.isArray(data) ? (data[0] as Row | undefined) : undefined) ?? null
}

/** The hash that makes a stored financial result current: finance input + tariff + the study pricing (I-1) + the run it priced. */
export const finInputsHash = (input: unknown, tariffRef: unknown, runId: string, pricingHash: string) => inputsHash({ input, tariffRef, runId, pricing: pricingHash })

export async function executeFinancialsRun(a: { user: AnyClient; svc: AnyClient; projectId: string; caseId: string; userId: string }): Promise<FinRunOutcome> {
  const run = await latestSucceededRun(a.user, a.projectId, a.caseId)
  if (!run) return { ok: false, status: 422, error: FIN_RUN_REASONS.noRun }
  const { data: finRows } = await a.user.schema('solar').from('case_financials').select('config').eq('case_id', a.caseId).eq('project_id', a.projectId)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  if (!finRow) return { ok: false, status: 422, error: FIN_RUN_REASONS.noFinancials }
  const fin = parseFinanceConfig(finRow.config)
  if (!fin.ok) return { ok: false, status: 422, error: FIN_RUN_REASONS.badFinancials }
  const cfg = parseCaseConfig(run.config_snapshot)
  if (!cfg.ok) return { ok: false, status: 422, error: FIN_RUN_REASONS.badRun }
  const outputs = run.outputs as CaseRunOutputs
  const kpis = outputs.kpis
  const early = financeInputReasons(fin.fin, { dcKwp: kpis.dcKwp })
  if (early.length > 0) return { ok: false, status: 422, error: early.join(' ') }
  const year = Number(outputs.provenance?.loadReferenceYear)
  const tariff = await resolveStudyTariff(a.svc, a.projectId, { year: Number.isInteger(year) && year > 0 ? year : undefined })
  if (!tariff.ok) return { ok: false, status: 422, error: tariff.reason }
  // Escalation (Tariff tab) and load growth (Load tab) are the study's (I-1), not the case config's.
  const built = buildFinanceInput(fin.fin, cfg.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw }, tariff.pricing)
  if (!built.ok) return { ok: false, status: 422, error: built.reasons.join(' ') }

  let hourly: ReturnType<typeof decodeHourlyCsv>
  try {
    hourly = decodeHourlyCsv(await getGzipText(a.svc, RUNS_BUCKET, run.hourly_path as string))
  } catch (e) {
    console.error('[solar-financials] stored hourly file unreadable', { caseId: a.caseId, runId: run.id, err: String(e) })
    return { ok: false, status: 500, error: FIN_RUN_REASONS.fileMissing }
  }
  let results: Record<string, unknown>
  try {
    // "Yes (no credit)" is part of the run's hashed input (CaseInput.export.credited): price export at zero.
    // The study's export rule 'none' prices at zero too (its SSEG rule is crediting 'none'); both agree here.
    const exportCredited = (run.export_settings as { credited?: unknown } | null | undefined)?.credited !== false && tariff.pricing.exportCredited
    const result = runStoredFinancials({ hourly, year1PvKwh: kpis.annualAcKwh, year1DeliveredKwh: kpis.deliveredKwh, exportCredited }, built.input, tariff.calc)
    results = { version: 1, capex: capexTotals(fin.fin.capex, kpis.dcKwp), ...result }
  } catch (e) {
    // The engine's validation message is for developers; the user gets a sentence, the log gets the text.
    console.error('[solar-financials] computation failed', { caseId: a.caseId, runId: run.id, err: String(e) })
    return { ok: false, status: 422, error: FIN_RUN_REASONS.computeFailed }
  }
  const { data, error } = await a.svc.schema('solar').from('case_run_financials').insert({
    case_run_id: run.id, engine_version: ENGINE_VERSION, fin_inputs: { finance: built.input, config: fin.fin },
    fin_inputs_hash: finInputsHash(built.input, tariff.tariffRef, run.id as string, tariff.pricingHash), tariff_ref: tariff.tariffRef, results,
    run_by: a.userId,
  }).select('id')
  if (error) {
    console.error('[solar-financials] insert failed', { caseId: a.caseId, runId: run.id, code: error.code })
    return { ok: false, status: 500, error: humanSolarError(error) }
  }
  return { ok: true, id: (Array.isArray(data) ? data[0]?.id : (data as Row | null)?.id) as string }
}
