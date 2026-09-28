import 'server-only'
/**
 * Run financials (functional spec §8): pure computation on the STORED run — the latest succeeded run's
 * hourly CSV and KPIs, the case config snapshot the run used, the saved financials and the study's
 * tariff. Writes one immutable solar.case_run_financials row through the caller's session (money RLS).
 * The tariff is priced on the run's stored load reference year (provenance.loadReferenceYear), the
 * same year the run's load was aligned to.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, inputsHash } from '@esite/shared/solar-engine'
import { buildFinanceInput, capexTotals, decodeHourlyCsv, parseCaseConfig, parseFinanceConfig, runStoredFinancials, type CaseRunOutputs } from '@esite/shared/solar-cases'
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
} as const

export type FinRunOutcome = { ok: true; id: string } | { ok: false; status: number; error: string }

export async function latestSucceededRun(user: AnyClient, caseId: string): Promise<Row | null> {
  const { data } = await user.schema('solar').from('case_runs').select('id, case_id, status, hourly_path, config_snapshot, outputs, started_at')
    .eq('case_id', caseId).eq('status', 'succeeded').order('started_at', { ascending: false }).limit(1)
  return (Array.isArray(data) ? (data[0] as Row | undefined) : undefined) ?? null
}

/** The hash that makes a stored financial result current: finance input + tariff + the run it priced. */
export const finInputsHash = (input: unknown, tariffRef: unknown, runId: string) => inputsHash({ input, tariffRef, runId })

export async function executeFinancialsRun(a: { user: AnyClient; svc: AnyClient; projectId: string; caseId: string }): Promise<FinRunOutcome> {
  const run = await latestSucceededRun(a.user, a.caseId)
  if (!run) return { ok: false, status: 422, error: FIN_RUN_REASONS.noRun }
  const { data: finRows } = await a.user.schema('solar').from('case_financials').select('config').eq('case_id', a.caseId)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  if (!finRow) return { ok: false, status: 422, error: FIN_RUN_REASONS.noFinancials }
  const fin = parseFinanceConfig(finRow.config)
  if (!fin.ok) return { ok: false, status: 422, error: FIN_RUN_REASONS.badFinancials }
  const cfg = parseCaseConfig(run.config_snapshot)
  if (!cfg.ok) return { ok: false, status: 422, error: FIN_RUN_REASONS.badRun }
  const outputs = run.outputs as CaseRunOutputs
  const kpis = outputs.kpis
  const built = buildFinanceInput(fin.fin, cfg.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw })
  if (!built.ok) return { ok: false, status: 422, error: built.reasons.join(' ') }
  const year = Number(outputs.provenance?.loadReferenceYear)
  const tariff = await resolveStudyTariff(a.svc, a.projectId, { year: Number.isInteger(year) && year > 0 ? year : undefined })
  if (!tariff.ok) return { ok: false, status: 422, error: tariff.reason }

  try {
    const hourly = decodeHourlyCsv(await getGzipText(a.svc, RUNS_BUCKET, run.hourly_path as string))
    const result = runStoredFinancials({ hourly, year1PvKwh: kpis.annualAcKwh, year1DeliveredKwh: kpis.deliveredKwh }, built.input, tariff.calc)
    const results = { version: 1, capex: capexTotals(fin.fin.capex, kpis.dcKwp), ...result }
    const { data, error } = await a.user.schema('solar').from('case_run_financials').insert({
      case_run_id: run.id, engine_version: ENGINE_VERSION, fin_inputs: { finance: built.input, config: fin.fin },
      fin_inputs_hash: finInputsHash(built.input, tariff.tariffRef, run.id as string), tariff_ref: tariff.tariffRef, results,
    }).select('id')
    if (error) {
      if (error.code === '42501') return { ok: false, status: 403, error: 'You need Edit + financials access to run financials.' }
      console.error('[solar-financials] insert failed', { caseId: a.caseId, runId: run.id, code: error.code })
      return { ok: false, status: 500, error: humanSolarError(error) }
    }
    return { ok: true, id: (Array.isArray(data) ? data[0]?.id : (data as Row | null)?.id) as string }
  } catch (e) {
    console.error('[solar-financials] failed', { caseId: a.caseId, runId: run.id, err: String(e) })
    return { ok: false, status: 500, error: `Financials could not be computed: ${e instanceof Error ? e.message : 'unexpected error'}` }
  }
}
