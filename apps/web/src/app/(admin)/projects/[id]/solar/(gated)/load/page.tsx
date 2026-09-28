import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { parseSubTab } from '@/lib/solar/load/subtabs'
import { loadChecksView, loadMetersView, loadProfileView, loadTenantsView } from '@/lib/solar/load/views'
import { LoadBasisBar } from './_components/LoadBasisBar'
import { LoadSubTabs } from './_components/LoadSubTabs'
import { MetersPanel } from './_components/MetersPanel'
import { TenantsPanel } from './_components/TenantsPanel'
import { SiteProfilePanel } from './_components/SiteProfilePanel'
import { ChecksPanel } from './_components/ChecksPanel'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Load tab (functional spec §4). View reads kW/kWh; Edit changes. Controls above the level are hidden, not disabled.
 * Every prop handed to a 'use client' component below is JSON (no functions) — page.test.tsx pins it.
 */
export default async function SolarLoadPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string | string[]; meter?: string | string[] }>
}) {
  const { id } = await params
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const canEdit = level !== 'view'
  const tab = parseSubTab(sp.tab)
  const openMeterId = (Array.isArray(sp.meter) ? sp.meter[0] : sp.meter) || null
  const [{ data: study }, grantor] = await Promise.all([
    supabase.schema('solar').from('studies').select('id, load_basis, updated_at').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
  ])
  const s = study as { id: string; load_basis: 'S1' | 'S2' | 'S3' | 'S4' | null; updated_at: string } | null
  const basis = s?.load_basis === 'S3' ? 'S2' : (s?.load_basis ?? '')
  let hint: string | null = null
  if (s && basis === 'S1') {
    const { data: links } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', s.id)
    const ids = ((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
    const { data: bulk } = ids.length
      ? await supabase.schema('solar').from('meters').select('id').in('id', ids).eq('kind', 'bulk').eq('supply_point_confirmed', true).limit(1)
      : { data: [] }
    if (!Array.isArray(bulk) || bulk.length === 0) hint = 'Confirm a bulk meter as the point of supply first (Meters → the meter → Details).'
  }
  const isGrantor = !grantor.error && grantor.data === true

  return (
    <div>
      <LoadBasisBar projectId={id} basis={basis} updatedAt={s?.updated_at ?? null} canEdit={canEdit} hint={hint} />
      <LoadSubTabs projectId={id} active={tab} />
      {tab === 'meters' && <MetersPanel projectId={id} canEdit={canEdit} openMeterId={openMeterId} view={await loadMetersView(supabase, id, isGrantor)} />}
      {tab === 'tenants' && <TenantsPanel projectId={id} canEdit={canEdit} view={await loadTenantsView(supabase, id)} />}
      {tab === 'profile' && <SiteProfilePanel projectId={id} canEdit={canEdit} view={await loadProfileView(supabase, id)} />}
      {tab === 'checks' && <ChecksPanel projectId={id} canEdit={canEdit} view={await loadChecksView(supabase, id)} />}
    </div>
  )
}
