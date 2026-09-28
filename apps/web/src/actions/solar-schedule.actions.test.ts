import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  audit: vi.fn(async () => {}),
  load: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/solar/schedule/loader', () => ({ loadScheduleData: h.load }))

import {
  loadScheduleAction, createScheduleTasksAction, updateScheduleTasksAction, deleteScheduleTasksAction, reorderScheduleTasksAction,
} from './solar-schedule.actions'
import { fakeSupabase, type FakeOptions } from '@/test/fake-supabase'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'

const P = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const task = { key: 'a', name: 'Design', start: '2026-10-01', end: '2026-10-05' }
const SOL01 = {
  code: 'SOL01',
  message: 'Client viewers and suppliers cannot own solar tasks, so "SOLAR-1" cannot be given to them. Choose someone on the project team.',
}

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('loadScheduleAction', () => {
  it('needs View and passes the level to the loader', async () => {
    setup()
    h.load.mockResolvedValue({ projectId: P })
    await expect(loadScheduleAction({ projectId: P })).resolves.toEqual({ ok: true, data: { projectId: P } })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'view', expect.anything())
    expect(h.load).toHaveBeenCalledWith(P, expect.anything(), 'edit', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })
})

describe('createScheduleTasksAction', () => {
  it('re-checks Edit itself', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(createScheduleTasksAction({ projectId: P, tasks: [task], links: [] })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })
  it('refuses a malformed task before calling the database', async () => {
    const { rpcCalls } = setup()
    const res = await createScheduleTasksAction({ projectId: P, tasks: [{ ...task, start: '01/10/2026' }], links: [] })
    expect(res).toEqual({ error: 'Check the task: every date must be a real calendar date and every task needs a name.' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('sends snake_case to the RPC, records one audit row, returns the key → id map', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_create_tasks': { data: { a: T }, error: null } } })
    const res = await createScheduleTasksAction({
      projectId: P, tasks: [{ ...task, ownerId: 'u2', isMilestone: false, category: 'Design' }],
      links: [{ from: 'a', to: T, type: 'SS', lagDays: 2 }],
    })
    expect(res).toEqual({ ok: true, ids: { a: T } })
    expect(rpcCalls[0]).toEqual({
      name: 'solar.schedule_create_tasks',
      args: {
        p_project_id: P,
        p_tasks: [expect.objectContaining({ key: 'a', name: 'Design', start: '2026-10-01', end: '2026-10-05', owner_id: 'u2', category: 'Design', is_milestone: false })],
        p_links: [{ from: 'a', to: T, type: 'SS', lag: 2 }],
        p_replace: false,
      },
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_tasks_added', objectRef: { count: 1 } })
  })
  it('an import records its mode', async () => {
    setup({ rpc: { 'solar.schedule_create_tasks': { data: { a: T }, error: null } } })
    await createScheduleTasksAction({ projectId: P, tasks: [task], links: [], replace: true, auditVerb: 'schedule_imported' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_imported', objectRef: { count: 1, mode: 'replace' } })
  })
  it('passes the spine’s sentence through', async () => {
    setup({ rpc: { 'solar.schedule_create_tasks': { data: null, error: { code: '22023', message: 'That person is not an active member of this project, so "Design" cannot be given to them.' } } } })
    await expect(createScheduleTasksAction({ projectId: P, tasks: [task], links: [] }))
      .resolves.toEqual({ error: 'That person is not an active member of this project, so "Design" cannot be given to them.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('a client viewer or supplier as owner comes back as the owner-guard sentence (Q4)', async () => {
    setup({ rpc: { 'solar.schedule_create_tasks': { data: null, error: SOL01 } } })
    await expect(createScheduleTasksAction({ projectId: P, tasks: [{ ...task, ownerId: 'u7' }], links: [] }))
      .resolves.toEqual({ error: SOL01.message })
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('never returns a raw Postgres message', async () => {
    setup({ rpc: { 'solar.schedule_create_tasks': { data: null, error: { code: 'XX000', message: 'relation "x" does not exist' } } } })
    await expect(createScheduleTasksAction({ projectId: P, tasks: [task], links: [] })).resolves.toEqual({ error: GENERIC_ERROR })
  })
})

describe('updateScheduleTasksAction', () => {
  it('sends only the keys that changed, with the concurrency token', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_update_tasks': { data: [{ id: T, updated_at: 'U2' }], error: null } } })
    const res = await updateScheduleTasksAction({ projectId: P, patches: [{ id: T, expectedUpdatedAt: 'U1', start: '2026-10-02', end: '2026-10-06' }] })
    expect(res).toEqual({ ok: true, updated: [{ id: T, updatedAt: 'U2' }] })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(rpcCalls[0].args).toEqual({ p_project_id: P, p_patches: [{ id: T, expected_updated_at: 'U1', start: '2026-10-02', end: '2026-10-06' }] })
  })
  it('stale write → the stale sentence', async () => {
    setup({ rpc: { 'solar.schedule_update_tasks': { data: null, error: { code: '40001', message: 'x' } } } })
    await expect(updateScheduleTasksAction({ projectId: P, patches: [{ id: T, expectedUpdatedAt: 'U0', progress: 50 }] }))
      .resolves.toEqual({ error: STALE_MESSAGE })
  })
  it('a patch without its concurrency token is refused as stale, before the database', async () => {
    const { rpcCalls } = setup()
    await expect(updateScheduleTasksAction({ projectId: P, patches: [{ id: T, progress: 50 }] })).resolves.toEqual({ error: STALE_MESSAGE })
    await expect(updateScheduleTasksAction({ projectId: P, patches: [{ id: T, expectedUpdatedAt: null, progress: 50 }] })).resolves.toEqual({ error: STALE_MESSAGE })
    expect(rpcCalls).toHaveLength(0)
  })
  it('reassigning to a client viewer or supplier → the owner-guard sentence (Q4)', async () => {
    setup({ rpc: { 'solar.schedule_update_tasks': { data: null, error: SOL01 } } })
    await expect(updateScheduleTasksAction({ projectId: P, patches: [{ id: T, expectedUpdatedAt: 'U1', ownerId: 'u7' }] }))
      .resolves.toEqual({ error: SOL01.message })
  })
  it('refuses an empty batch', async () => {
    setup()
    await expect(updateScheduleTasksAction({ projectId: P, patches: [] })).resolves.toEqual({ error: 'Nothing to change.' })
  })
})

describe('deleteScheduleTasksAction and reorderScheduleTasksAction', () => {
  it('deletes through the RPC and records the count', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_delete_tasks': { data: 2, error: null } } })
    await expect(deleteScheduleTasksAction({ projectId: P, taskIds: [T, T.replace('2222', '3333')] })).resolves.toEqual({ ok: true, removed: 2 })
    expect(rpcCalls[0].name).toBe('solar.schedule_delete_tasks')
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_tasks_removed', objectRef: { count: 2 } })
  })
  it('reorders the full id list at Edit level', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_reorder': { data: 1, error: null } } })
    await expect(reorderScheduleTasksAction({ projectId: P, orderedIds: [T] })).resolves.toEqual({ ok: true })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(rpcCalls[0].args).toEqual({ p_project_id: P, p_ids: [T] })
  })
})
