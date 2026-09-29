import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P, I, D } from './solar-operations.test-helpers'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit'),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), seed: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { addDowntimeAction, deleteDowntimeAction, updateDowntimeAction } from './solar-operations.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', writes: { 'solar.downtime:insert': { data: [{ id: D }] } }, ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}
const good = { projectId: P, installationId: I, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T12:00', cause: 'inverter_fault', description: '', excludedFromGuarantee: false, source: 'manual' as const }
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('addDowntimeAction', () => {
  it('reads datetime-local as SAST and stores UTC', async () => {
    const f = setup()
    await expect(addDowntimeAction(good)).resolves.toEqual({ ok: true, id: D })
    expect(callsTo(f.calls, 'solar.downtime', 'insert')[0]!.payload).toEqual({
      installation_id: I, starts_at: '2026-03-10T08:00:00.000Z', ends_at: '2026-03-10T10:00:00.000Z',
      cause: 'inverter_fault', description: null, excluded_from_guarantee: false, source: 'manual',
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'downtime_added', objectRef: { id: D, hours: 2, source: 'manual' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_downtime_saved', properties: { action: 'added', source: 'manual' } })
  })
  it('a confirmed candidate arrives as ISO and is recorded as detected', async () => {
    const f = setup()
    await addDowntimeAction({ ...good, startsAt: '2026-03-10T09:30:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', source: 'detected' })
    expect(callsTo(f.calls, 'solar.downtime', 'insert')[0]!.payload).toMatchObject({ starts_at: '2026-03-10T09:30:00.000Z', source: 'detected' })
  })
  it('validates before writing', async () => {
    const f = setup()
    await expect(addDowntimeAction({ ...good, endsAt: '2026-03-10T09:00' })).resolves.toEqual({ fieldErrors: { endsAt: 'The end must be after the start.' } })
    await expect(addDowntimeAction({ ...good, endsAt: '2026-04-15T09:00' })).resolves.toEqual({ fieldErrors: { endsAt: 'One entry covers at most 31 days — split longer outages.' } })
    await expect(addDowntimeAction({ ...good, cause: 'aliens' })).resolves.toEqual({ fieldErrors: { cause: 'Choose a cause.' } })
    await expect(addDowntimeAction({ ...good, startsAt: 'yesterday' })).resolves.toEqual({ fieldErrors: { startsAt: 'Enter a date and time.' } })
    expect(f.calls).toHaveLength(0)
  })
  it('the overlap refusal is shown in words', async () => {
    setup({ writes: { 'solar.downtime:insert': { error: { code: '23P01', message: 'solar.downtime: this window overlaps recorded downtime' } } } })
    await expect(addDowntimeAction(good)).resolves.toEqual({ error: 'This window overlaps recorded downtime.' })
  })
})

describe('update / delete', () => {
  it('updates on the loaded version', async () => {
    const f = setup({ writes: { 'solar.downtime:update': { data: [{ updated_at: 'D2' }] } } })
    await expect(updateDowntimeAction({ projectId: P, id: D, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T11:00', cause: 'grid_outage', description: 'Eskom', excludedFromGuarantee: true, expectedUpdatedAt: 'D1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'D2' })
    const u = callsTo(f.calls, 'solar.downtime', 'update')[0]!
    expect(u.payload).toMatchObject({ cause: 'grid_outage', description: 'Eskom', excluded_from_guarantee: true })
    expect(u.filters).toEqual([['eq', 'id', D], ['eq', 'updated_at', 'D1']])
  })
  it('deletes (the history trigger keeps the old row)', async () => {
    const f = setup()
    await expect(deleteDowntimeAction({ projectId: P, id: D })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.downtime', 'delete')[0]!.filters).toEqual([['eq', 'id', D]])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'downtime_deleted', objectRef: { id: D } })
  })
})
