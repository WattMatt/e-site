import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSolarActivity } from '@/lib/solar/activity'
import { loadHeadlineKpis, loadSolarReadinessExtra, runsByCase } from '@/lib/solar/cases/page-data'
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

  // Everything below runs only after the level gate; the service client reads study inputs for the Stale rule.
  const svc = createServiceClient() as unknown as AnyClient
  const [{ data: project }, { data: study }, { data: isGrantor }, activity, extra, { data: caseRows }, runs] = await Promise.all([
    supabase.schema('projects').from('projects').select('name, address, city, province').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva, tariff_id, export_rule, selected_case_id, updated_at').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
    loadSolarActivity(id, supabase),
    loadSolarReadinessExtra(supabase, svc, id, level),
    supabase.schema('solar').from('cases').select('id, name').eq('project_id', id),
    runsByCase(supabase, id),
  ])
  const studyRow = study as { selected_case_id?: string | null; updated_at?: string } | null
  const selectedCaseId = studyRow?.selected_case_id ?? null
  const kpis = await loadHeadlineKpis(supabase, id, level, selectedCaseId)
  // Only a case with a completed run can be selected (studies_selected_case_check).
  const selectable = ((caseRows ?? []) as Array<{ id: string; name: string }>).filter((c) => runs.ok.has(c.id)).map((c) => ({ id: c.id, name: c.name }))
  const p = (project ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const licensee = (study as { licensee_name?: string | null } | null)?.licensee_name?.trim() || null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StudyHeader projectName={p.name ?? ''} address={address} supplyAuthority={licensee} />
      <ReadinessChecklist projectId={id} steps={withTariffReadiness(computeSolarReadiness(toSiteReadinessInput(study), level, extra), await loadTariffReadinessInput(supabase, study as Record<string, unknown> | null))} />
      <OverviewKpis projectId={id} level={level} kpis={kpis} selectable={selectable} selectedCaseId={selectedCaseId}
        studyUpdatedAt={studyRow?.updated_at ?? null} stale={extra.stale !== null} />
      <ActivityList projectId={id} items={activity} isGrantor={isGrantor === true} />
    </div>
  )
}
