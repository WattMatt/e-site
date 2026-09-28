import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { sastToday } from '@esite/shared'
import { ScheduleClient } from './ScheduleClient'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Schedule tab (spec §14). View level reads; Edit and above change (the
 * actions and RLS re-check every write). Everything handed to the client is
 * JSON — no functions, Dates, Maps or Sets cross this boundary (the #201
 * lesson): ScheduleData is plain data and the export URL base is built in the
 * client from the project id.
 */
export default async function SolarSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const data = await loadScheduleData(id, supabase, level, sastToday())
  return <ScheduleClient initial={data} />
}
