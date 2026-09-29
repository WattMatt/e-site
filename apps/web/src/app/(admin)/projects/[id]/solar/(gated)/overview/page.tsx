import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSolarActivity } from '@/lib/solar/activity'
import { computeSolarReadiness, toSiteReadinessInput, withTariffReadiness } from '@esite/shared'
import { loadTariffReadinessInput } from '@/lib/solar/tariff/readiness-input'
import { ReadinessChecklist } from '../../_components/ReadinessChecklist'
import { StudyHeader } from '../../_components/StudyHeader'
import { OverviewKpis } from '../../_components/OverviewKpis'
import { ActivityList } from '../../_components/ActivityList'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Overview (spec §2): header · readiness · headline KPIs · recent activity. */
export default async function SolarOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)

  const [{ data: project }, { data: study }, { data: isGrantor }, activity] = await Promise.all([
    supabase.schema('projects').from('projects').select('name, address, city, province').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva, tariff_id, export_rule').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
    loadSolarActivity(id, supabase),
  ])
  const p = (project ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const licensee = (study as { licensee_name?: string | null } | null)?.licensee_name?.trim() || null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StudyHeader projectName={p.name ?? ''} address={address} supplyAuthority={licensee} />
      <ReadinessChecklist projectId={id} steps={withTariffReadiness(computeSolarReadiness(toSiteReadinessInput(study), level), await loadTariffReadinessInput(supabase, study as Record<string, unknown> | null))} />
      <OverviewKpis projectId={id} level={level} />
      <ActivityList projectId={id} items={activity} isGrantor={isGrantor === true} />
    </div>
  )
}
