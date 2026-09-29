'use server'
/**
 * Save a TOU calendar (spec §12). One SQL call, tariffs.save_tou_calendar
 * (00214): the calendar, its windows and its holiday rule change in one
 * transaction, so a reader never sees a calendar half-saved, and an edit is
 * refused (40001) when someone else saved the calendar after this editor
 * loaded it. SECURITY INVOKER: 00210's admin-only write policies decide.
 */
import { revalidatePath } from 'next/cache'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError } from '@/lib/tariffs/errors'
import { validateCalendarForm, type CalendarForm } from '@/lib/tariffs/calendar-form'

const CALENDAR_STALE = 'Someone else changed this calendar. Reload to see their version.'

export async function saveTouCalendarAction(input: { calendarId: string | null; expectedUpdatedAt: string | null; form: CalendarForm }): Promise<
  { ok: true; id: string; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const v = validateCalendarForm(input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const { data, error } = await gate.supabase.schema('tariffs').rpc('save_tou_calendar', {
    p_calendar_id: input.calendarId,
    p_expected_updated_at: input.calendarId === null ? null : input.expectedUpdatedAt,
    p_calendar: {
      licensee_id: v.value.licensee_id, valid_from: v.value.valid_from, valid_to: v.value.valid_to,
      high_season_months: v.value.high_season_months, source: v.value.source,
    },
    p_windows: v.value.windows,
    p_holiday: v.value.holidayTreatedAs,
  })
  if (error) {
    if (error.code === '40001') return { error: CALENDAR_STALE }
    if (error.code === 'P0002') return { error: 'That calendar no longer exists. Reload the page.' }
    return { error: humanTariffError(error) }
  }
  const saved = (data ?? {}) as { id?: string; updated_at?: string }
  revalidatePath('/admin/tariffs/calendars')
  return { ok: true, id: String(saved.id ?? ''), updatedAt: String(saved.updated_at ?? '') }
}
