import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadLayoutList, loadRoofSources } from '@/lib/solar/layout-loader'
import { LayoutList } from './LayoutList'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Layout tab (functional spec §6.2). View lists and opens read-only; Edit creates and manages. */
export default async function SolarLayoutListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const [layouts, roof] = await Promise.all([loadLayoutList(supabase, id), loadRoofSources(supabase, id)])
  return (
    <LayoutList projectId={id} canEdit={level !== 'view'} layouts={layouts}
      sources={roof.sources.map((s) => ({ id: s.id, label: s.label, pixelsPerMeter: s.pixelsPerMeter }))} />
  )
}
