import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { computeSolarReadiness, toSiteReadinessInput } from '@esite/shared'
import { ReadinessChecklist } from '../../_components/ReadinessChecklist'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export default async function SolarOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const { data: study } = await supabase
    .schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva').eq('project_id', id).maybeSingle()
  return <ReadinessChecklist projectId={id} steps={computeSolarReadiness(toSiteReadinessInput(study), level)} />
}
