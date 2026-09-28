import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { SCHEDULE_LOAD_ERROR, ScheduleLoadError } from '@/lib/solar/schedule/load-error'
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
  let data
  try {
    data = await loadScheduleData(id, supabase, level, sastToday())
  } catch (err) {
    if (!(err instanceof ScheduleLoadError)) throw err
    console.error('[solar-schedule] load failed', { project: id, source: err.source, detail: err.detail })
    // Never an empty schedule: an editor could apply the template on top of the real programme.
    return <p role="alert" style={{ padding: 16, color: 'var(--c-red, #b91c1c)' }}>{SCHEDULE_LOAD_ERROR}</p>
  }
  return <ScheduleClient initial={data} />
}
