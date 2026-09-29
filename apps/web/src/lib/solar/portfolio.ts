import 'server-only'
/** Rows from public.solar_portfolio (00216): only projects the CALLER may view; saving only with money. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortfolioRow, PortfolioStage } from './portfolio-model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function loadPortfolio(user: AnyClient, orgId: string): Promise<PortfolioRow[]> {
  const { data, error } = await user.rpc('solar_portfolio', { p_org_id: orgId })
  if (error) { console.error('[solar-portfolio] failed', { code: error.code }); return [] }
  return ((data ?? []) as Row[]).map((r) => ({
    projectId: String(r.project_id), projectName: String(r.project_name ?? ''),
    province: (r.province as string | null) ?? null, city: (r.city as string | null) ?? null,
    licenseeName: (r.licensee_name as string | null) ?? null, stage: r.stage as PortfolioStage,
    selectedCaseName: (r.selected_case_name as string | null) ?? null,
    selectedKwp: num(r.selected_kwp), proposedKwp: num(r.proposed_kwp),
    year1SavingZar: r.can_see_money === true ? num(r.year1_saving_zar) : null,
    lastActivity: (r.last_activity as string | null) ?? null, canSeeMoney: r.can_see_money === true,
  }))
}
