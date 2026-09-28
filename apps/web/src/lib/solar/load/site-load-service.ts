// apps/web/src/lib/solar/load/site-load-service.ts
import 'server-only'
/**
 * Rebuild the study's site series (functional spec §4.5 "Rebuild site profile"): gather → the pure
 * builder → one solar.site_load row per study (older bases/years are removed so "the profile" is
 * unambiguous). Written with the caller's client; site_load's RESTRICTIVE policies need Solar Edit.
 * Recorded in solar.audit_events only — no product event (owner decision 2026-09-29: no new
 * product_events verbs in Phase 3b).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSiteLoad, LoadModelError, SITE_LOAD_ENGINE_VERSION } from '@esite/shared/solar-load'
import { recordSolarAudit } from '@/lib/solar/audit'
import { gatherLoadInputs } from './gather'
import { loadErrorMessage } from './messages'
import type { RebuildEvent } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function rebuildSiteLoad(
  supabase: AnyClient, projectId: string, userId: string, emit: (e: RebuildEvent) => void,
): Promise<{ ok: true; siteLoadId: string } | { ok: false }> {
  emit({ type: 'progress', stage: 'reading', done: 0, total: 1 })
  const g = await gatherLoadInputs(supabase, projectId, {
    readReadings: true,
    onProgress: (done, total) => emit({ type: 'progress', stage: 'reading', done, total }),
  })
  if (!g.ok) {
    emit({ type: 'error', code: g.error, message: loadErrorMessage(g.error) })
    return { ok: false }
  }
  emit({ type: 'progress', stage: 'building', done: 0, total: 1 })
  let r: ReturnType<typeof buildSiteLoad>
  try {
    r = buildSiteLoad(g.input)
  } catch (e) {
    if (e instanceof LoadModelError) {
      emit({ type: 'error', code: e.code, message: e.message })
      return { ok: false }
    }
    throw e
  }
  emit({ type: 'progress', stage: 'saving', done: 0, total: 1 })
  const { data, error } = await supabase.schema('solar').from('site_load').upsert({
    study_id: g.study.id,
    basis: r.basis,
    reference_year: r.referenceYear,
    series: Array.from(r.series, (v) => Math.round(v * 1000) / 1000),
    md_monthly: r.mdMonthly,
    coverage: { ...r.coverage, designMdKw: r.designMdKw, checks: r.checks, reconciliation: r.reconciliation, tenants: r.tenants },
    inputs_hash: g.inputsHash,
    engine_version: SITE_LOAD_ENGINE_VERSION,
    built_by: userId,
    built_at: new Date().toISOString(),
  }, { onConflict: 'study_id,basis,reference_year' }).select('id').single()
  const id = (data as { id?: string } | null)?.id
  if (error || !id) {
    emit({ type: 'error', code: 'save_failed', message: loadErrorMessage('save_failed') })
    return { ok: false }
  }
  await supabase.schema('solar').from('site_load').delete().eq('study_id', g.study.id).neq('id', id)
  await recordSolarAudit({ projectId, actorId: userId, verb: 'site_load_built', objectRef: { basis: r.basis, referenceYear: r.referenceYear } })
  emit({ type: 'done', siteLoadId: id, basis: r.basis, referenceYear: r.referenceYear, checks: r.checks.length })
  return { ok: true, siteLoadId: id }
}
