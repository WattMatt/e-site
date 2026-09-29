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
  buildFinanceInput, caseStatus, parseCaseConfig, parseFinanceConfig, type CaseRunOutputs, type CaseStatus, type LatestRunLite,
} from '@esite/shared/solar-cases'
import type { RunContextResult, StudyInputs } from './run-context'
import { finInputsHash } from './financials'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** True when the latest case_run_financials row prices `runId` on the study pricing as it stands now. */
export async function financialsOnCurrentPricing(svc: AnyClient, shared: StudyInputs, caseId: string, runId: string): Promise<boolean> {
  if (!shared.tariff.ok) return false
  const solar = svc.schema('solar')
  const [{ data: fin }, { data: run }, { data: res }] = await Promise.all([
    solar.from('case_financials').select('config').eq('case_id', caseId).maybeSingle(),
    solar.from('case_runs').select('id, config_snapshot, outputs').eq('id', runId).maybeSingle(),
    solar.from('case_run_financials').select('case_run_id, fin_inputs_hash').eq('case_id', caseId).order('created_at', { ascending: false }).limit(1),
  ])
  const latest = Array.isArray(res) ? (res[0] as Row | undefined) : undefined
  if (!latest || latest.case_run_id !== runId || !fin || !run) return false
  const parsedFin = parseFinanceConfig((fin as Row).config)
  const snap = parseCaseConfig((run as Row).config_snapshot)
  const kpis = ((run as Row).outputs as CaseRunOutputs | undefined)?.kpis
  if (!parsedFin.ok || !snap.ok || !kpis) return false
  const built = buildFinanceInput(parsedFin.fin, snap.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw }, shared.tariff.pricing)
  if (!built.ok) return false
  return latest.fin_inputs_hash === finInputsHash(built.input, shared.tariff.tariffRef, runId, shared.tariff.pricingHash)
}

/**
 * The one status every Solar surface shows (Yield card, Overview, Financials, Reports): caseStatus with
 * the energy hashes, asking the financials question only when the verdict would be "Pricing changed".
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
  if (first.status !== 'pricing_changed' || !lastOk) return first
  const absorbed = await financialsOnCurrentPricing(svc, shared, caseId, String(lastOk.id))
  return caseStatus(latestLite, stored, current, Date.now(), { ...energy, financialsOnCurrentPricing: absorbed })
}
