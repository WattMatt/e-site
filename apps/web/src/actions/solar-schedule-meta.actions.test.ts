import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))

import {
  addScheduleLinkAction, updateScheduleLinkAction, removeScheduleLinkAction, saveBaselineAction, deleteBaselineAction,
  loadBaselineTasksAction, saveFilterPresetAction, deleteFilterPresetAction, saveScheduleSettingsAction,
} from './solar-schedule-meta.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'
import { EMPTY_SCHEDULE_FILTERS } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const A = '22222222-2222-4222-8222-222222222222'
const B = '33333333-3333-4333-8333-333333333333'

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('links', () => {
  it('adds a link at Edit level and returns its id', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_dependencies:insert': { data: [{ id: 'd1' }] } } })
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'FF', lagDays: -1 }))
      .resolves.toEqual({ ok: true, id: 'd1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(calls, 'solar.schedule_dependencies', 'insert')[0].payload)
      .toEqual({ project_id: P, predecessor_task_id: A, successor_task_id: B, link_type: 'FF', lag_days: -1 })
  })
  it('re-checks Edit itself before touching anything', async () => {
    const { calls } = setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'FS', lagDays: 0 })).rejects.toThrow('REDIRECT')
    expect(calls).toHaveLength(0)
  })
  it('a loop comes back as a sentence', async () => {
    setup({ writes: { 'solar.schedule_dependencies:insert': { error: { code: '23514', message: 'solar.schedule_dependencies: this link would create a loop' } } } })
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'FS', lagDays: 0 }))
      .resolves.toEqual({ error: 'That link would make these tasks depend on each other in a loop.' })
  })
  it('refuses a self link and a bad type or lag without calling the database', async () => {
    const { calls } = setup()
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: A, type: 'FS', lagDays: 0 }))
      .resolves.toEqual({ error: 'A task cannot depend on itself.' })
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'XX' as never, lagDays: 0 }))
      .resolves.toEqual({ error: 'Choose two tasks, a link type and a lag of at most 365 days.' })
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'FS', lagDays: 400 }))
      .resolves.toEqual({ error: 'Choose two tasks, a link type and a lag of at most 365 days.' })
    expect(calls).toHaveLength(0)
  })
  it('editing a link that is gone says so', async () => {
    setup({ writes: { 'solar.schedule_dependencies:update': { data: [] } } })
    await expect(updateScheduleLinkAction({ projectId: P, linkId: A, type: 'SS', lagDays: 2 }))
      .resolves.toEqual({ error: 'That link is no longer on this schedule. Reload to see the current programme.' })
  })
  it('edits type and lag scoped to the project', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_dependencies:update': { data: [{ id: A }] } } })
    await expect(updateScheduleLinkAction({ projectId: P, linkId: A, type: 'SS', lagDays: 2 })).resolves.toEqual({ ok: true })
    const u = callsTo(calls, 'solar.schedule_dependencies', 'update')[0]
    expect(u.payload).toEqual({ link_type: 'SS', lag_days: 2 })
    expect(u.filters).toEqual([['eq', 'id', A], ['eq', 'project_id', P]])
  })
  it('removes a link scoped to the project', async () => {
    const { calls } = setup()
    await expect(removeScheduleLinkAction({ projectId: P, linkId: A })).resolves.toEqual({ ok: true })
    expect(callsTo(calls, 'solar.schedule_dependencies', 'delete')[0].filters).toEqual([['eq', 'id', A], ['eq', 'project_id', P]])
  })
})

describe('baselines', () => {
  it('saves through the RPC and records the name', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_save_baseline': { data: 'b1', error: null } } })
    await expect(saveBaselineAction({ projectId: P, name: '  Contract  ', description: '' })).resolves.toEqual({ ok: true, id: 'b1' })
    expect(rpcCalls[0]).toEqual({ name: 'solar.schedule_save_baseline', args: { p_project_id: P, p_name: 'Contract', p_description: '' } })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_baseline_saved', objectRef: { name: 'Contract' } })
  })
  it('a blank name never reaches the database', async () => {
    const { rpcCalls } = setup()
    await expect(saveBaselineAction({ projectId: P, name: ' ', description: '' })).resolves.toEqual({ error: 'Give the baseline a name.' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('a duplicate name comes back as a sentence, and nothing is audited', async () => {
    setup({ rpc: { 'solar.schedule_save_baseline': { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "schedule_baselines_name_unique"' } } } })
    await expect(saveBaselineAction({ projectId: P, name: 'Contract', description: '' }))
      .resolves.toEqual({ error: 'A baseline with that name already exists.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('deletes and loads at the right levels', async () => {
    setup({ tables: { 'solar.schedule_baseline_tasks': [
      { baseline_id: A, project_id: P, task_id: null, work_item_ref: 'SOLAR-1', name: 'Design', start_date: '2026-10-01', end_date: '2026-10-05', is_milestone: false, sort_order: 1 },
    ] } })
    await expect(deleteBaselineAction({ projectId: P, baselineId: A })).resolves.toEqual({ ok: true })
    expect(h.requireSolarLevel).toHaveBeenLastCalledWith(P, 'edit', expect.anything())
    h.requireSolarLevel.mockResolvedValue('view')
    await expect(loadBaselineTasksAction({ projectId: P, baselineId: A })).resolves.toEqual({
      ok: true, tasks: [{ taskId: null, ref: 'SOLAR-1', name: 'Design', start: '2026-10-01', end: '2026-10-05', isMilestone: false }],
    })
    expect(h.requireSolarLevel).toHaveBeenLastCalledWith(P, 'view', expect.anything())
  })
  it('a baseline or project id that is not an id is a sentence, and nothing reaches the database', async () => {
    const { calls } = setup()
    await expect(loadBaselineTasksAction({ projectId: P, baselineId: 'b1' })).resolves.toEqual({ error: 'That baseline is no longer there.' })
    await expect(loadBaselineTasksAction({ projectId: 'nope', baselineId: A })).resolves.toEqual({ error: 'That project could not be found.' })
    expect(calls).toHaveLength(0)
    expect(h.requireSolarLevel).not.toHaveBeenCalled()
  })
  it('a baseline of more than 1,000 tasks loads in full (pages past max_rows)', async () => {
    setup({ maxRows: 1000, tables: { 'solar.schedule_baseline_tasks': Array.from({ length: 1200 }, (_, i) => (
      { baseline_id: A, project_id: P, task_id: null, work_item_ref: `SOLAR-${i}`, name: `T${i}`, start_date: '2026-10-01', end_date: '2026-10-05', is_milestone: false, sort_order: i }
    )) } })
    const r = await loadBaselineTasksAction({ projectId: P, baselineId: A })
    expect('tasks' in r && r.tasks.length).toBe(1200)
  })
})

describe('presets (View level)', () => {
  it('saves a well-formed filter set for the caller', async () => {
    h.requireSolarLevel.mockResolvedValue('view')
    const { calls } = setup({ writes: { 'solar.schedule_filter_presets:insert': { data: [{ id: 'f1' }] } } })
    await expect(saveFilterPresetAction({ projectId: P, name: 'Late', filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['in_progress'] } }))
      .resolves.toEqual({ ok: true, id: 'f1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'view', expect.anything())
    expect(callsTo(calls, 'solar.schedule_filter_presets', 'insert')[0].payload)
      .toEqual({ project_id: P, user_id: 'u1', name: 'Late', filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['in_progress'] } })
  })
  it('strips unknown keys from the stored filter object', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_filter_presets:insert': { data: [{ id: 'f1' }] } } })
    await saveFilterPresetAction({ projectId: P, name: 'X', filters: { ...EMPTY_SCHEDULE_FILTERS, evil: '<script>' } as never })
    expect(callsTo(calls, 'solar.schedule_filter_presets', 'insert')[0].payload).toEqual({ project_id: P, user_id: 'u1', name: 'X', filters: EMPTY_SCHEDULE_FILTERS })
  })
  it('refuses a malformed filter object and a duplicate name', async () => {
    setup({ writes: { 'solar.schedule_filter_presets:insert': { error: { code: '23505', message: 'schedule_filter_presets_name_unique' } } } })
    await expect(saveFilterPresetAction({ projectId: P, name: 'X', filters: { search: 1 } as never })).resolves.toEqual({ error: 'That filter could not be saved.' })
    await expect(saveFilterPresetAction({ projectId: P, name: 'X', filters: EMPTY_SCHEDULE_FILTERS })).resolves.toEqual({ error: 'You already have a preset with that name.' })
  })
  it('deletes only the caller’s preset', async () => {
    const { calls } = setup()
    await expect(deleteFilterPresetAction({ projectId: P, presetId: A })).resolves.toEqual({ ok: true })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'view', expect.anything())
    expect(callsTo(calls, 'solar.schedule_filter_presets', 'delete')[0].filters)
      .toEqual([['eq', 'id', A], ['eq', 'project_id', P], ['eq', 'user_id', 'u1']])
  })
})

describe('saveScheduleSettingsAction', () => {
  it('first save inserts; later saves are stale-guarded', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_settings:insert': { data: [{ updated_at: 'S1' }] }, 'solar.schedule_settings:update': { data: [] } } })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'working', workloadThreshold: 3, expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'S1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(calls, 'solar.schedule_settings', 'insert')[0].payload).toEqual({ project_id: P, duration_mode: 'working', workload_threshold: 3 })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'calendar', workloadThreshold: 3, expectedUpdatedAt: 'S0' }))
      .resolves.toEqual({ error: STALE_MESSAGE })
    expect(callsTo(calls, 'solar.schedule_settings', 'update')[0].filters).toEqual([['eq', 'project_id', P], ['eq', 'updated_at', 'S0']])
  })
  it('a first save racing another first save is stale, not a raw duplicate-key message', async () => {
    setup({ writes: { 'solar.schedule_settings:insert': { error: { code: '23505', message: 'duplicate key value violates unique constraint "schedule_settings_pkey"' } } } })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'working', workloadThreshold: 2, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: STALE_MESSAGE })
  })
  it('a matching token saves', async () => {
    setup({ writes: { 'solar.schedule_settings:update': { data: [{ updated_at: 'S2' }] } } })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'calendar', workloadThreshold: 5, expectedUpdatedAt: 'S1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'S2' })
  })
  it('refuses a threshold outside 1–50 and an unknown mode', async () => {
    setup()
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'working', workloadThreshold: 0, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'The workload limit must be a whole number from 1 to 50.' })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'weeks' as never, workloadThreshold: 2, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Choose calendar days or working days.' })
  })
  it('never returns a raw Postgres message', async () => {
    setup({ writes: { 'solar.schedule_settings:update': { error: { code: 'XX000', message: 'internal' } } } })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'calendar', workloadThreshold: 2, expectedUpdatedAt: 'S1' }))
      .resolves.toEqual({ error: GENERIC_ERROR })
  })
})
