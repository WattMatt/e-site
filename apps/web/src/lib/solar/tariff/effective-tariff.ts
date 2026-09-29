import 'server-only'
/**
 * The tariff the Tariff tab bill check costs for this study: `loadStudyPricing` (the ONE pricing
 * loader, shared with Yield & Financials — I-1) read through the caller's session, because the
 * override and the export rates are money tables (00213). The tariff is the resolver's: the project
 * override's rows when there is one (D-10), else the pinned published tariff.
 */
import type { Tariff } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudyPricing } from '../pricing/load-study-pricing'
import { loadStudyCalendar } from './calendar-loader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface EffectiveTariff {
  studyId: string
  tariff: Tariff
  tariffId: string
  overrideId: string | null
  nmdKva: number | null
  highSeasonMonths: number[] | null
}

export const EFFECTIVE_TARIFF_READ_ERROR = 'The tariff could not be loaded. Try again.'

/** calendarOnIso: the date whose TOU calendar applies (a bill check passes mid-billing-month). */
export async function loadEffectiveTariff(supabase: AnyClient, projectId: string, calendarOnIso: string): Promise<EffectiveTariff | { error: string }> {
  const r = await loadStudyPricing(supabase, projectId)
  if (!r.ok) {
    switch (r.code) {
      case 'noStudy': return { error: 'Save Site & Supply first.' }
      case 'notPinned': return { error: 'Choose a tariff first.' }
      case 'tariffMissing': return { error: 'The pinned tariff is no longer readable. Reload the page.' }
      case 'studyReadFailed':
        console.error('[solar-effective-tariff] read failed', { projectId, what: 'studies', code: r.error.code })
        return { error: EFFECTIVE_TARIFF_READ_ERROR }
      default: return { error: EFFECTIVE_TARIFF_READ_ERROR }
    }
  }
  const cal = await loadStudyCalendar(supabase, r.study.licenseeId, calendarOnIso)
  return {
    studyId: r.study.id, tariff: r.pricing.tariff, tariffId: r.study.tariffId, overrideId: r.pricing.provenance.overrideId,
    nmdKva: r.study.nmdKva, highSeasonMonths: cal.calendar?.highSeasonMonths ?? null,
  }
}
