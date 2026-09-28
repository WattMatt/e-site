import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { computeSolarReadiness, toSiteReadinessInput } from '@esite/shared'
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
  const [{ data: project }, { data: study }] = await Promise.all([
    supabase.schema('projects').from('projects').select('name').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva').eq('project_id', id).maybeSingle(),
  ])
  const readiness = computeSolarReadiness(toSiteReadinessInput(study), level)

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar</h1>
          <p className="page-subtitle">{(project as { name?: string } | null)?.name ?? ''}</p>
        </div>
      </div>
      {level === 'view' && <ViewOnlyBanner projectId={id} />}
      <SolarTabBar projectId={id} level={level} readiness={readiness} />
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}
