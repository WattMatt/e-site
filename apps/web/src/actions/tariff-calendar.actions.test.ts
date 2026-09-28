import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveTouCalendarAction } from './tariff-calendar.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const form = {
  licenseeId: '11111111-1111-1111-1111-111111111111', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8],
  source: 'published' as const, holidayTreatedAs: 'sunday' as const,
  windows: [{ season: 'high' as const, dayType: 'weekday' as const, start: '06:00', end: '09:00', period: 'peak' as const }],
}

beforeEach(() => vi.clearAllMocks())

describe('saveTouCalendarAction', () => {
  it('new calendar: inserts the calendar, its windows and the holiday rule', async () => {
    const fake = fakeSupabase({ userId: 'a1', writes: { 'tariffs.tou_calendar:insert': { data: [{ id: 'cal1' }] } } })
    h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
    expect(await saveTouCalendarAction({ calendarId: null, form })).toEqual({ ok: true, id: 'cal1' })
    expect(callsTo(fake.calls, 'tariffs.tou_window', 'insert')[0].payload).toEqual([
      { calendar_id: 'cal1', season: 'high', day_type: 'weekday', start_minute: 360, end_minute: 540, period: 'peak' },
    ])
    expect(callsTo(fake.calls, 'tariffs.holiday_rule', 'insert')[0].payload).toEqual({ calendar_id: 'cal1', treated_as: 'sunday' })
  })
  it('existing calendar: new windows are inserted BEFORE the old ones are deleted', async () => {
    const fake = fakeSupabase({
      userId: 'a1',
      tables: { 'tariffs.tou_window': [{ id: 'w-old', calendar_id: 'cal1' }], 'tariffs.holiday_rule': [{ calendar_id: 'cal1', treated_as: 'saturday' }] },
      writes: { 'tariffs.tou_calendar:update': { data: [{ id: 'cal1' }] }, 'tariffs.tou_window:insert': { data: [{ id: 'w-new' }] } },
    })
    h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
    expect(await saveTouCalendarAction({ calendarId: 'cal1', form })).toEqual({ ok: true, id: 'cal1' })
    const ops = fake.calls.filter((c) => c.table === 'tariffs.tou_window' && c.op !== 'select').map((c) => c.op)
    expect(ops).toEqual(['insert', 'delete'])
    expect(callsTo(fake.calls, 'tariffs.tou_window', 'delete')[0].filters).toEqual([['in', 'id', ['w-old']]])
    expect(callsTo(fake.calls, 'tariffs.holiday_rule', 'update')[0].payload).toEqual({ treated_as: 'sunday' })
  })
  it('an invalid form writes nothing', async () => {
    const fake = fakeSupabase({ userId: 'a1' })
    h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
    const r = await saveTouCalendarAction({ calendarId: null, form: { ...form, highSeasonMonths: [] } })
    expect(r).toEqual({ fieldErrors: { highSeasonMonths: 'Pick the high-demand months' } })
    expect(fake.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
})
