import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadOperationsView } from '@/lib/solar/operations/data'
import { OperationsTab } from './OperationsTab'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Operations (spec §10). View level reads everything technical; Edit writes; Edit + financials sees the monthly report. */
export default async function SolarOperationsPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { id } = await params
  const { month } = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const view = await loadOperationsView({
    user: supabase, svc: createServiceClient() as unknown as AnyClient, projectId: id, level, month: typeof month === 'string' ? month : null,
  })
  return <OperationsTab projectId={id} view={view} />
}
