import 'server-only'
/**
 * The tariff the engine costs for this study: the project override's rows
 * when there is one (D-10), else the pinned published tariff. Read through
 * the caller's session: the override is a money table (00213).
 * Reuses 2a's tariffFromRows (the same mapper the library and the ingest use).
 */
import { overrideChargeFromDb, overrideToTariff, type Tariff } from '@esite/shared'
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudyCalendar } from './calendar-loader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface EffectiveTariff {
  studyId: string
  tariff: Tariff
  tariffId: string
  overrideId: string | null
  nmdKva: number | null
  highSeasonMonths: number[] | null
}

export async function loadEffectiveTariff(supabase: AnyClient, projectId: string, todayIso: string): Promise<EffectiveTariff | { error: string }> {
  const { data: s } = await supabase.schema('solar').from('studies')
    .select('id, tariff_id, tariff_override_id, nmd_kva, licensee_id').eq('project_id', projectId).maybeSingle()
  const study = s as Row | null
  if (!study) return { error: 'Save Site & Supply first.' }
  if (!study.tariff_id) return { error: 'Choose a tariff first.' }
  const t = supabase.schema('tariffs')
  const [{ data: tr }, { data: cs }] = await Promise.all([
    t.from('tariff').select('*').eq('id', String(study.tariff_id)).maybeSingle(),
    t.from('charge').select('*').eq('tariff_id', String(study.tariff_id)),
  ])
  if (!tr) return { error: 'The pinned tariff is no longer readable. Reload the page.' }
  let tariff = tariffFromRows(tr as Row, (cs ?? []) as Row[])
  const overrideId = (study.tariff_override_id ?? null) as string | null
  if (overrideId) {
    const { data: rows } = await supabase.schema('solar').from('tariff_override_charges').select('*').eq('override_id', overrideId)
    tariff = overrideToTariff(tariff, ((rows ?? []) as Row[]).map(overrideChargeFromDb))
  }
  const cal = await loadStudyCalendar(supabase, (study.licensee_id ?? null) as string | null, todayIso)
  return {
    studyId: String(study.id), tariff, tariffId: String(study.tariff_id), overrideId,
    nmdKva: study.nmd_kva === null || study.nmd_kva === undefined ? null : Number(study.nmd_kva),
    highSeasonMonths: cal.calendar?.highSeasonMonths ?? null,
  }
}
