/**
 * The Tariff readiness input for a studies row (spec §2.3, §5). A linked-tariff
 * export rule is only met while the PINNED tariff has an export tariff, and
 * PostgREST cannot embed tariffs.tariff into solar.studies across schemas, so
 * this is a second read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { toTariffReadinessInput, type TariffReadinessInput } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function loadTariffReadinessInput(
  supabase: AnyClient, study: Record<string, unknown> | null | undefined,
): Promise<TariffReadinessInput | null> {
  if (!study) return null
  let linked = false
  if (typeof study.tariff_id === 'string') {
    const { data } = await supabase.schema('tariffs').from('tariff').select('export_tariff_id').eq('id', study.tariff_id).maybeSingle()
    linked = Boolean((data as { export_tariff_id?: string | null } | null)?.export_tariff_id)
  }
  return toTariffReadinessInput(study, linked)
}
