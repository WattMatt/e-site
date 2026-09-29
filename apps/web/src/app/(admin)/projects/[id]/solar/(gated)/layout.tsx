import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSolarReadinessExtra } from '@/lib/solar/cases/page-data'
import { computeSolarReadiness, toSiteReadinessInput, withTariffReadiness } from '@esite/shared'
import { loadTariffReadinessInput } from '@/lib/solar/tariff/readiness-input'
import { loadLoadReadiness } from '@/lib/solar/load/views'
import { loadLayoutReadiness } from '@/lib/solar/layout-readiness'
import { scheduleTaskCountOf } from '@/lib/solar/schedule/task-count'
import { SolarTabBar } from '../_components/SolarTabBar'
import { ViewOnlyBanner } from '../_components/ViewOnlyBanner'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Gate for every Solar module page (spec §0.3). Anyone without a level —
 * unsubscribed org, no grant, supplier, client viewer, non-member — is sent to
 * /solar/locked, which lives OUTSIDE this group (no loop) and itself sends
 * suppliers/client viewers back to the project. Each page and action
 * re-checks its own level; this gate is not the only one.
 */
export default async function SolarGatedLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const level = await requireSolarLevel(id, 'view', supabase)
  const [{ data: project }, { data: study }, grantorRes, loadReady, layoutReady, scheduleRes] = await Promise.all([
    supabase.schema('projects').from('projects').select('name, organisation_id').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva, tariff_id, export_rule').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
    loadLoadReadiness(supabase, id),
    loadLayoutReadiness(supabase, id),
    supabase.schema('solar').from('schedule_tasks').select('id', { count: 'exact', head: true }).eq('project_id', id),
  ])
  // Owner default 1 (2026-09-28): grantors get a way to the Access panel from
  // the module chrome. Hidden (not disabled) for everyone else; the panel's
  // own loader and every grantor action re-check solar_is_grantor.
  const isGrantor = !grantorRes.error && grantorRes.data === true
  // A View user may ask for Edit only if they can ever hold it: members of the
  // project's own organisation. Externals are capped at View (00207).
  let isOwnOrgMember = false
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  if (level === 'view' && orgId) {
    const { data: membership } = await supabase.from('user_organisations').select('organisation_id')
      .eq('user_id', user.id).eq('organisation_id', orgId).eq('is_active', true).limit(1)
    isOwnOrgMember = Array.isArray(membership) && membership.length > 0
  }
  // Yield / Financials dots come from the stored runs (Phase 4b). Only after the level gate above.
  const extra = await loadSolarReadinessExtra(supabase, createServiceClient() as unknown as AnyClient, id, level)
  // tariff_id / export_rule hold no rand value (the manual export RATE lives in
  // the money table), so this select is safe at View; the tariff step itself
  // exists only at Edit + financials (visibleSolarTabs).
  const readiness = withTariffReadiness(computeSolarReadiness(toSiteReadinessInput(study), level, { ...extra, load: loadReady.load, schematics: loadReady.schematics, layout: layoutReady, scheduleTaskCount: scheduleTaskCountOf(scheduleRes) }), await loadTariffReadinessInput(supabase, study as Record<string, unknown> | null))

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar</h1>
          <p className="page-subtitle">{(project as { name?: string } | null)?.name ?? ''}</p>
        </div>
        {isGrantor && (
          <Link href={`/projects/${id}/solar/access`} style={{ fontSize: 12, color: 'var(--c-amber)', alignSelf: 'center' }}>
            Manage access
          </Link>
        )}
      </div>
      {level === 'view' && <ViewOnlyBanner projectId={id} canRequestEdit={isOwnOrgMember} />}
      <SolarTabBar projectId={id} level={level} readiness={readiness} />
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}
