import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveTouCalendarAction } from './tariff-calendar.actions'
import { fakeSupabase } from '@/test/fake-supabase'

const form = {
  licenseeId: '11111111-1111-1111-1111-111111111111', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8],
  source: 'published' as const, holidayTreatedAs: 'sunday' as const,
  windows: [{ season: 'high' as const, dayType: 'weekday' as const, start: '06:00', end: '09:00', period: 'peak' as const }],
}

beforeEach(() => vi.clearAllMocks())

function adminWithRpc(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const fake = fakeSupabase({ userId: 'a1' })
  const rpc = vi.fn(async () => result)
  const client = { ...fake.client, schema: (s: string) => ({ ...fake.client.schema(s), rpc }) }
  h.gate.mockResolvedValue({ ok: true, supabase: client, userId: 'a1' })
  return { fake, rpc }
}

describe('saveTouCalendarAction', () => {
  it('new calendar: ONE SQL call carries the calendar, its windows and the holiday rule', async () => {
    const { fake, rpc } = adminWithRpc({ data: { id: 'cal1', updated_at: 'U1' }, error: null })
    expect(await saveTouCalendarAction({ calendarId: null, expectedUpdatedAt: null, form })).toEqual({ ok: true, id: 'cal1', updatedAt: 'U1' })
    expect(rpc).toHaveBeenCalledWith('save_tou_calendar', {
      p_calendar_id: null, p_expected_updated_at: null,
      p_calendar: { licensee_id: form.licenseeId, valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'published' },
      p_windows: [{ season: 'high', day_type: 'weekday', start_minute: 360, end_minute: 540, period: 'peak' }],
      p_holiday: 'sunday',
    })
    expect(fake.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
    expect(h.revalidate).toHaveBeenCalledWith('/admin/tariffs/calendars')
  })
  it('existing calendar: the save is conditioned on the updated_at the editor loaded', async () => {
    const { rpc } = adminWithRpc({ data: { id: 'cal1', updated_at: 'U2' }, error: null })
    expect(await saveTouCalendarAction({ calendarId: 'cal1', expectedUpdatedAt: 'U1', form: { ...form, holidayTreatedAs: '' } }))
      .toEqual({ ok: true, id: 'cal1', updatedAt: 'U2' })
    expect(rpc).toHaveBeenCalledWith('save_tou_calendar', expect.objectContaining({ p_calendar_id: 'cal1', p_expected_updated_at: 'U1', p_holiday: null }))
  })
  it('a calendar someone else saved first is refused as stale; a deleted one says so', async () => {
    adminWithRpc({ data: null, error: { code: '40001', message: 'tariffs.save_tou_calendar: stale' } })
    expect(await saveTouCalendarAction({ calendarId: 'cal1', expectedUpdatedAt: 'U0', form }))
      .toEqual({ error: 'Someone else changed this calendar. Reload to see their version.' })
    adminWithRpc({ data: null, error: { code: 'P0002', message: 'tariffs.save_tou_calendar: that calendar no longer exists' } })
    expect(await saveTouCalendarAction({ calendarId: 'cal1', expectedUpdatedAt: 'U0', form }))
      .toEqual({ error: 'That calendar no longer exists. Reload the page.' })
    expect(h.revalidate).not.toHaveBeenCalled()
  })
  it('an invalid form writes nothing', async () => {
    const { fake, rpc } = adminWithRpc({ data: null, error: null })
    const r = await saveTouCalendarAction({ calendarId: null, expectedUpdatedAt: null, form: { ...form, highSeasonMonths: [] } })
    expect(r).toEqual({ fieldErrors: { highSeasonMonths: 'Pick the high-demand months' } })
    expect(fake.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })
})
