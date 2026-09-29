import 'server-only'
/**
 * "Pricing changed" vs "Stale" (the energy). The case hash is energy + study pricing (I-1), so a
 * tariff override, export rule, escalation or load-growth edit alone makes it differ from the run's.
 * The energy results still hold in that case, so the fix is a financials-only re-run — and once the
 * latest financial result prices the run on the CURRENT pricing, the case is Done again.
 *
 * Read with the SERVICE client after the caller's Solar gate; only a boolean leaves this module (the
 * pricing hash is keyed, and no money row is returned), so a View caller learns nothing it could not
 * already see from the "Stale" label it replaces.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildFinanceInput, caseStatus, financeCaseConfig, financeCaseInputsKey, parseCaseConfig, parseFinanceConfig,
  type CaseConfig, type CaseRunOutputs, type CaseStatus, type LatestRunLite,
} from '@esite/shared/solar-cases'
import type { RunContextResult, StudyInputs } from './run-context'
import { finInputsHash } from './financials'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Where the latest case_run_financials row stands for `runId`: 'none' = there is no financial result
 * for this run (none at all, or only an older run's); 'current' = it prices this run on the study
 * pricing as it stands now AND on the case's CURRENT degradation / load shedding (YF-01; `current` =
 * the saved case config, null = the run's own snapshot); 'differs' = anything else.
 */
async function financialsState(
  svc: AnyClient, shared: StudyInputs, caseId: string, runId: string, current: CaseConfig | null,
): Promise<'none' | 'current' | 'differs'> {
  if (!shared.tariff.ok) return 'differs'
  const solar = svc.schema('solar')
  const [{ data: fin }, { data: run }, { data: res }] = await Promise.all([
    solar.from('case_financials').select('config').eq('case_id', caseId).maybeSingle(),
    solar.from('case_runs').select('id, config_snapshot, outputs').eq('id', runId).maybeSingle(),
    solar.from('case_run_financials').select('case_run_id, fin_inputs_hash').eq('case_id', caseId).order('created_at', { ascending: false }).limit(1),
  ])
  const latest = Array.isArray(res) ? (res[0] as Row | undefined) : undefined
  if (!latest || latest.case_run_id !== runId) return 'none'
  if (!fin || !run) return 'differs'
  const parsedFin = parseFinanceConfig((fin as Row).config)
  const snap = parseCaseConfig((run as Row).config_snapshot)
  const kpis = ((run as Row).outputs as CaseRunOutputs | undefined)?.kpis
  if (!parsedFin.ok || !snap.ok || !kpis) return 'differs'
  const built = buildFinanceInput(parsedFin.fin, current ? financeCaseConfig(snap.config, current) : snap.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw }, shared.tariff.pricing)
  if (!built.ok) return 'differs'
  return latest.fin_inputs_hash === finInputsHash(built.input, shared.tariff.tariffRef, runId, shared.tariff.pricingHash) ? 'current' : 'differs'
}

/** True when the latest case_run_financials row prices `runId` on today's pricing and case (see financialsState). */
export async function financialsOnCurrentPricing(
  svc: AnyClient, shared: StudyInputs, caseId: string, runId: string, current: CaseConfig | null = null,
): Promise<boolean> {
  return (await financialsState(svc, shared, caseId, runId, current)) === 'current'
}

/**
 * The one status every Solar surface shows (Yield card, Overview, Financials, Reports): caseStatus with
 * the energy hashes, asking the financials question only when the verdict would be "Pricing changed".
 * Degradation and load shedding are money-only (not in the energy input, so not in the run's hash):
 * when the case's current values differ from the run snapshot's (`lastOk.snap_degradation` /
 * `snap_load_shedding`, selected by runsByCase) and this run's financials priced the old values, a
 * Done case is "Pricing changed" until the financials are re-run on them (YF-01). A case with no
 * financials for the run stays Done: there is nothing priced to be out of date.
 */
export async function resolveCaseStatus(
  svc: AnyClient,
  shared: StudyInputs,
  caseId: string,
  latest: Row | undefined,
  lastOk: Row | undefined,
  ctx: RunContextResult,
): Promise<{ status: CaseStatus; label: string }> {
  const latestLite: LatestRunLite | null = latest ? { status: latest.status, inputsHash: latest.inputs_hash, startedAt: latest.started_at } : null
  const stored = lastOk ? { inputsHash: String(lastOk.inputs_hash), energyHash: (lastOk.energy_hash as string | null | undefined) ?? null } : null
  const current = ctx.ok ? ctx.ctx.currentHash : null
  const energy = { currentEnergyHash: ctx.ok ? ctx.ctx.energyHash : null }
  const first = caseStatus(latestLite, stored, current, Date.now(), energy)
  const cfg = ctx.ok ? (ctx.ctx.config ?? null) : null
  const snapKey = lastOk ? financeCaseInputsKey({ degradation: lastOk.snap_degradation, loadShedding: lastOk.snap_load_shedding }) : null
  const financeMoved = first.status === 'done' && cfg !== null && snapKey !== null && financeCaseInputsKey(cfg) !== snapKey
  if ((first.status !== 'pricing_changed' && !financeMoved) || !lastOk) return first
  const state = await financialsState(svc, shared, caseId, String(lastOk.id), cfg)
  // A money-only edit matters only to financials that exist for this run and priced the old values.
  if (financeMoved) return state === 'differs' ? { status: 'pricing_changed', label: 'Pricing changed' } : first
  return caseStatus(latestLite, stored, current, Date.now(), { ...energy, financialsOnCurrentPricing: state === 'current' })
}
