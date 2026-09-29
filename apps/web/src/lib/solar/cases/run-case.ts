import 'server-only'
/**
 * One run, end to end (functional spec §7.2 Run). The running row is INSERTed through the caller's
 * session (00216 RLS: Solar Edit); the result is written by the service client, which is the only
 * role allowed to UPDATE a run, and only while it is running (freeze trigger). Every failure is kept
 * on the row with a sentence and logged with the run id.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, simulateCase } from '@esite/shared/solar-engine'
import { buildRunOutputs, encodeHourlyCsv, hourlyFromResult, RUN_TIMEOUT_MS } from '@esite/shared/solar-cases'
import { humanSolarError } from '@/lib/solar/errors'
import { loadRunContext } from './run-context'
import { loadWeatherYear } from './weather'
import { putGzipText, removeObject, runCsvPath, RUNS_BUCKET } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Every sentence a run can store on case_runs.error or return: fixed text — raw errors are logged only. */
export const RUN_REASONS = {
  timedOut: 'The run timed out (no result after 90 s).',
  failed: 'The run failed unexpectedly — try again. If it keeps failing, contact support.',
  inputsChanged: 'The inputs changed while the run was being prepared — run it again.',
  notSaved: 'The run finished but its result could not be saved — run it again.',
  cancelled: 'The run was cancelled.',
} as const

class RunSentence extends Error {}

export type RunOutcome =
  | { ok: true; runId: string; status: 'succeeded' }
  | { ok: false; status: number; error: string; runId?: string }

export async function executeCaseRun(a: { user: AnyClient; svc: AnyClient; projectId: string; caseId: string; userId: string; now?: () => number }): Promise<RunOutcome> {
  const now = a.now ?? Date.now
  const runs = () => a.svc.schema('solar').from('case_runs')
  // A run killed at maxDuration stays 'running' forever; close it so the unique running index frees up.
  // Service client, before the context check: scoped to this project as well as the case.
  await runs().update({ status: 'failed', error: RUN_REASONS.timedOut })
    .eq('case_id', a.caseId).eq('project_id', a.projectId).eq('status', 'running').lt('started_at', new Date(now() - RUN_TIMEOUT_MS).toISOString())

  const loaded = await loadRunContext(a.svc, a.projectId, a.caseId)
  if (!loaded.ok) return { ok: false, status: loaded.status, error: loaded.error }
  const ctx = loaded.ctx
  if (!ctx.build.ok) return { ok: false, status: 422, error: ctx.build.reasons.join(' ') }
  const input = ctx.build.input
  // build.ok implies a resolved weather row (contextForCase clears an unresolvable dataset id).
  const weather = ctx.weather!

  const { data, error } = await a.user.schema('solar').from('case_runs').insert({
    case_id: a.caseId, engine_version: ENGINE_VERSION, inputs: input, inputs_hash: ctx.currentHash,
    config_snapshot: ctx.config, weather_dataset_id: weather.id, tariff_ref: ctx.tariff.ok ? ctx.tariff.tariffRef : null,
  }).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, error: 'A run of this case is already in progress.' }
    if (error.code === '42501') return { ok: false, status: 403, error: 'You need Edit access to run a case.' }
    console.error('[solar-run] insert failed', { caseId: a.caseId, projectId: a.projectId, code: error.code })
    return { ok: false, status: 500, error: humanSolarError(error) }
  }
  const runId = (Array.isArray(data) ? data[0]?.id : (data as { id?: string } | null)?.id) as string
  const path = runCsvPath(ctx.study.organisation_id, a.projectId, a.caseId, runId)

  try {
    const year = await loadWeatherYear(a.svc, weather as { storage_path: string; radiation_db?: string | null })
    const result = simulateCase(input, { id: weather.id, year })
    // simulateCase hashes the energy input; the row's inputs_hash (currentHash) also carries the pricing.
    if (result.inputsHash !== ctx.energyHash) throw new RunSentence(RUN_REASONS.inputsChanged)
    const gsa = weather.gsa_pvout_kwh_per_kwp
    const outputs = buildRunOutputs(result, input, {
      weatherFetchedAt: weather.fetched_at ?? null,
      gsaPvoutKwhPerKwp: gsa === null || gsa === undefined ? null : Number(gsa),
      tariffRef: ctx.tariff.ok ? ctx.tariff.tariffRef : null,
      touPeriods: ctx.touPeriods,
      nmdKva: ctx.study.nmd_kva,
      loadBasis: ctx.siteLoad?.basis ?? '',
      // The one year of the context: the load's (caseLoadFromSiteSeries), the same the tariff was priced on.
      loadReferenceYear: ctx.referenceYear,
    })
    await putGzipText(a.svc, RUNS_BUCKET, path, encodeHourlyCsv(hourlyFromResult(result)))
    const { data: done, error: doneErr } = await runs().update({ status: 'succeeded', outputs, hourly_path: path })
      .eq('id', runId).eq('status', 'running').select('id')
    if (doneErr) {
      // A failed write is NOT a cancellation: keep the row honest and say what happened.
      console.error('[solar-run] finishing update failed', { runId, caseId: a.caseId, projectId: a.projectId, code: doneErr.code })
      await removeObject(a.svc, RUNS_BUCKET, path)
      await runs().update({ status: 'failed', error: RUN_REASONS.notSaved }).eq('id', runId).eq('status', 'running')
      return { ok: false, status: 500, error: RUN_REASONS.notSaved, runId }
    }
    if (!Array.isArray(done) || done.length === 0) {
      await removeObject(a.svc, RUNS_BUCKET, path)
      return { ok: false, status: 409, error: RUN_REASONS.cancelled, runId }
    }
    return { ok: true, runId, status: 'succeeded' }
  } catch (e) {
    // Only our own fixed sentences reach the user and the row; the raw error is logged with the run id.
    const sentence = e instanceof RunSentence ? e.message : RUN_REASONS.failed
    console.error('[solar-run] failed', { runId, caseId: a.caseId, projectId: a.projectId, err: String(e) })
    await runs().update({ status: 'failed', error: sentence }).eq('id', runId).eq('status', 'running')
    return { ok: false, status: 500, error: sentence, runId }
  }
}
