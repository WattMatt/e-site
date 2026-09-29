import 'server-only'
/**
 * The TOU calendar a study uses: its licensee's calendar valid on the date,
 * else Eskom's hours flagged assumed_eskom (spec §5 "TOU hours notice").
 * Read through the caller's session (00210: readable by subscribed orgs).
 */
import { calendarFromRows, pickCalendar, resolveStudyCalendar, type TouCalendar } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calendarRowFromDb, windowFromDb } from './rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

async function licenseeCalendar(supabase: AnyClient, licenseeId: string, onIso: string): Promise<TouCalendar | null> {
  const t = supabase.schema('tariffs')
  const { data } = await t.from('tou_calendar').select('id, licensee_id, valid_from, valid_to, high_season_months, source').eq('licensee_id', licenseeId)
  const row = pickCalendar(((data ?? []) as Row[]).map((r) => calendarRowFromDb(r, null)), onIso)
  if (!row) return null
  const [{ data: ws }, { data: hr }] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', row.id),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', row.id).maybeSingle(),
  ])
  const holiday = ((hr as { treated_as?: 'saturday' | 'sunday' } | null)?.treated_as) ?? null
  return calendarFromRows({ ...row, holidayTreatedAs: holiday }, ((ws ?? []) as Row[]).map(windowFromDb))
}

export async function loadStudyCalendar(supabase: AnyClient, licenseeId: string | null, onIso: string) {
  const own = licenseeId ? await licenseeCalendar(supabase, licenseeId, onIso) : null
  let eskom: TouCalendar | null = null
  if (!own) {
    const { data } = await supabase.schema('tariffs').from('licensee').select('id').eq('kind', 'eskom').limit(1)
    const eskomId = ((data ?? []) as Row[])[0]?.id as string | undefined
    if (eskomId && eskomId !== licenseeId) eskom = await licenseeCalendar(supabase, eskomId, onIso)
  }
  return resolveStudyCalendar(own, eskom)
}
