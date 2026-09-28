'use server'
/**
 * Save a TOU calendar (spec §12). Admin session writes (00209 admin policies).
 * Windows: insert the new set first, then delete the old ids, so a failed
 * insert never leaves a calendar without windows.
 */
import { revalidatePath } from 'next/cache'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError } from '@/lib/tariffs/errors'
import { validateCalendarForm, type CalendarForm } from '@/lib/tariffs/calendar-form'

export async function saveTouCalendarAction(input: { calendarId: string | null; form: CalendarForm }): Promise<
  { ok: true; id: string } | { error: string } | { fieldErrors: Record<string, string> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const v = validateCalendarForm(input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const t = gate.supabase.schema('tariffs')
  const cal = {
    licensee_id: v.value.licensee_id, valid_from: v.value.valid_from, valid_to: v.value.valid_to,
    high_season_months: v.value.high_season_months, source: v.value.source,
  }
  let id = input.calendarId
  if (id === null) {
    const { data, error } = await t.from('tou_calendar').insert(cal).select('id')
    if (error) return { error: humanTariffError(error) }
    id = String((data as Array<{ id: string }>)[0]?.id ?? '')
  } else {
    const { data, error } = await t.from('tou_calendar').update(cal).eq('id', id).select('id')
    if (error) return { error: humanTariffError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: 'That calendar no longer exists. Reload the page.' }
  }

  const { data: old } = await t.from('tou_window').select('id').eq('calendar_id', id)
  const oldIds = ((old ?? []) as Array<{ id: string }>).map((w) => w.id)
  if (v.value.windows.length > 0) {
    const { error } = await t.from('tou_window').insert(v.value.windows.map((w) => ({ calendar_id: id, ...w })))
    if (error) return { error: humanTariffError(error) }
  }
  if (oldIds.length > 0) {
    const { error } = await t.from('tou_window').delete().in('id', oldIds)
    if (error) return { error: `The new hours were saved but the old ones could not be removed: ${humanTariffError(error)} Reload and save again.` }
  }

  const { data: rule } = await t.from('holiday_rule').select('calendar_id').eq('calendar_id', id)
  const hasRule = Array.isArray(rule) && rule.length > 0
  if (v.value.holidayTreatedAs === null) {
    if (hasRule) await t.from('holiday_rule').delete().eq('calendar_id', id)
  } else if (hasRule) {
    const { error } = await t.from('holiday_rule').update({ treated_as: v.value.holidayTreatedAs }).eq('calendar_id', id)
    if (error) return { error: humanTariffError(error) }
  } else {
    const { error } = await t.from('holiday_rule').insert({ calendar_id: id, treated_as: v.value.holidayTreatedAs })
    if (error) return { error: humanTariffError(error) }
  }
  revalidatePath('/admin/tariffs/calendars')
  return { ok: true, id }
}
