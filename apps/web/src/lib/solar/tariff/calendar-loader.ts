import 'server-only'
/**
 * The TOU calendar a study uses: its licensee's calendar valid on the date,
 * else Eskom's hours flagged assumed_eskom (spec §5 "TOU hours notice").
 * The ONE calendar resolver: the Tariff tab reads it through the caller's
 * session (00210: readable by subscribed orgs), the case run (cases/tariff.ts)
 * through the service client — so the hours the tab shows are the hours a run
 * prices.
 */
import { calendarFromRows, pickCalendar, resolveStudyCalendar, type TouCalendar } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calendarRowFromDb, windowFromDb } from './rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

/** The calendar row the hours came from. `licenseeName` is set for the Eskom stand-in only. */
export interface CalendarOrigin { id: string; licenseeId: string; licenseeName: string | null; validFrom: string }

async function licenseeCalendar(supabase: AnyClient, licenseeId: string, onIso: string): Promise<{ calendar: TouCalendar; origin: CalendarOrigin } | null> {
  const t = supabase.schema('tariffs')
  const { data } = await t.from('tou_calendar').select('id, licensee_id, valid_from, valid_to, high_season_months, source').eq('licensee_id', licenseeId)
  const row = pickCalendar(((data ?? []) as Row[]).map((r) => calendarRowFromDb(r, null)), onIso)
  if (!row) return null
  const [{ data: ws }, { data: hr }] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', row.id),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', row.id).maybeSingle(),
  ])
  const holiday = ((hr as { treated_as?: 'saturday' | 'sunday' } | null)?.treated_as) ?? null
  return {
    calendar: calendarFromRows({ ...row, holidayTreatedAs: holiday }, ((ws ?? []) as Row[]).map(windowFromDb)),
    origin: { id: row.id, licenseeId: row.licenseeId, licenseeName: null, validFrom: row.validFrom },
  }
}

/**
 * Eskom's calendar valid on the date. There are two Eskom licensees (direct and local-authority
 * supplies); they are tried in name order so the stand-in never depends on row order.
 */
async function eskomCalendar(supabase: AnyClient, exceptId: string | null, onIso: string) {
  const { data } = await supabase.schema('tariffs').from('licensee').select('id, name').eq('kind', 'eskom')
  const eskoms = ((data ?? []) as Row[])
    .map((r) => ({ id: String(r.id), name: String(r.name) }))
    .filter((r) => r.id !== exceptId)
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const e of eskoms) {
    const found = await licenseeCalendar(supabase, e.id, onIso)
    if (found) return { ...found, origin: { ...found.origin, licenseeName: e.name } }
  }
  return null
}

export async function loadStudyCalendar(supabase: AnyClient, licenseeId: string | null, onIso: string) {
  const own = licenseeId ? await licenseeCalendar(supabase, licenseeId, onIso) : null
  const eskom = own ? null : await eskomCalendar(supabase, licenseeId, onIso)
  return { ...resolveStudyCalendar(own?.calendar ?? null, eskom?.calendar ?? null), origin: own?.origin ?? eskom?.origin ?? null }
}
