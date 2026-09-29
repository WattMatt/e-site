import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))

import { commitScheduleImportAction } from './solar-schedule-import.actions'
import { fakeSupabase, type FakeOptions } from '@/test/fake-supabase'
import type { ImportPlan, PlannedTask } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const task = (over: Partial<PlannedTask>): PlannedTask => ({
  key: 'p1', sourceRow: 2, name: 'Design', category: '', zone: '', start: '2026-10-01', end: '2026-10-05', isMilestone: false,
  progress: 0, status: 'not_started', colour: null, ownerHint: null, description: '', segments: [], ...over,
})
const plan: ImportPlan = {
  tasks: [
    task({ key: 'p1', sourceRow: 2, name: 'Design', category: 'Design', ownerHint: 'ann@x.co.za' }),
    task({ key: 'p2', sourceRow: 3, name: 'Install', start: '2026-10-06', end: '2026-10-08', ownerHint: 'Nobody Known' }),
  ],
  links: [{ fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 }],
}
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    userId: 'u1',
    rpc: {
      // The Solar-ELIGIBLE list only (owner decision Q4): no client viewers, no suppliers.
      'solar.schedule_owner_candidates': { data: [{ user_id: 'u9', full_name: 'Ann Smith', email: 'ann@x.co.za' }], error: null },
      'solar.schedule_create_tasks': { data: { p1: 't1', p2: 't2' }, error: null },
    },
    ...extra,
  })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('commitScheduleImportAction', () => {
  it('resolves owners, commits in ONE call with the replace flag, reports unmatched owners and their rows', async () => {
    const { rpcCalls } = setup()
    await expect(commitScheduleImportAction({ projectId: P, mode: 'replace', plan })).resolves.toEqual({
      ok: true, created: 2, unmatchedOwners: ['Nobody Known'],
      unmatchedRows: [{ row: 3, task: 'Install', owner: 'Nobody Known' }],
    })
    const creates = rpcCalls.filter((c) => c.name === 'solar.schedule_create_tasks')
    expect(creates).toHaveLength(1)
    expect(creates[0].args.p_replace).toBe(true)
    expect((creates[0].args.p_tasks as Array<{ owner_id: string | null }>).map((t) => t.owner_id)).toEqual(['u9', null])
    expect(creates[0].args.p_links).toEqual([{ from: 'p1', to: 'p2', type: 'FS', lag: 0 }])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_imported', objectRef: { count: 2, mode: 'replace' } })
  })
  it('a client viewer named in the file is unmatched: default owner, listed back, never sent to the database', async () => {
    const { rpcCalls } = setup()
    const withViewer: ImportPlan = {
      tasks: [
        task({ key: 'p1', sourceRow: 2, name: 'Design', ownerHint: 'Cara Client' }),
        task({ key: 'p2', sourceRow: 5, name: 'Install', ownerHint: 'cara@client.co.za' }),
        task({ key: 'p3', sourceRow: 6, name: 'Commission', ownerHint: 'Ann Smith' }),
      ],
      links: [],
    }
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan: withViewer })).resolves.toEqual({
      ok: true, created: 3, unmatchedOwners: ['Cara Client', 'cara@client.co.za'],
      unmatchedRows: [
        { row: 2, task: 'Design', owner: 'Cara Client' },
        { row: 5, task: 'Install', owner: 'cara@client.co.za' },
      ],
    })
    const sent = rpcCalls.find((c) => c.name === 'solar.schedule_create_tasks')!.args.p_tasks as Array<{ owner_id: string | null }>
    expect(sent.map((t) => t.owner_id)).toEqual([null, null, 'u9'])
    expect(rpcCalls.find((c) => c.name === 'solar.schedule_owner_candidates')!.args).toEqual({ p_project_id: P })
  })
  it('re-validates: a loop is refused before anything is written', async () => {
    const { rpcCalls } = setup()
    const loop = { ...plan, links: [...plan.links, { fromKey: 'p2', toKey: 'p1', type: 'FS' as const, lagDays: 0 }] }
    const res = await commitScheduleImportAction({ projectId: P, mode: 'append', plan: loop })
    expect(res).toEqual({ error: 'These tasks depend on each other in a loop: Install → Design → Install.' })
    expect(rpcCalls.filter((c) => c.name === 'solar.schedule_create_tasks')).toHaveLength(0)
  })
  it('re-validates dates: a task that ends before it starts is refused with its name', async () => {
    const { rpcCalls } = setup()
    const bad = { tasks: [task({ name: 'Design', start: '2026-10-05', end: '2026-10-01' })], links: [] }
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan: bad })).resolves.toEqual({ error: '"Design" ends before it starts.' })
    const notADate = { tasks: [task({ name: 'Design', start: '2026-02-30', end: '2026-03-01' })], links: [] }
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan: notADate }))
      .resolves.toEqual({ error: '"Design" has a date that is not a real calendar date.' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('refuses a malformed plan, an empty plan and an unknown mode', async () => {
    setup()
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan: { tasks: [{}] } as never }))
      .resolves.toEqual({ error: 'The import could not be read. Start the import again.' })
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan: { tasks: [], links: [] } }))
      .resolves.toEqual({ error: 'The file has no tasks.' })
    await expect(commitScheduleImportAction({ projectId: P, mode: 'merge' as never, plan }))
      .resolves.toEqual({ error: 'Choose whether to add to the programme or replace it.' })
  })
  it('re-checks Edit itself: a lower level never reaches the database', async () => {
    const { rpcCalls } = setup()
    h.requireSolarLevel.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan })).rejects.toThrow('NEXT_REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(rpcCalls).toHaveLength(0)
  })
  it('the SOL01 owner guard refuses the whole transaction with a sentence; nothing is audited', async () => {
    setup({ rpc: {
      'solar.schedule_owner_candidates': { data: [], error: null },
      'solar.schedule_create_tasks': { data: null, error: { code: 'SOL01', message: 'Client viewers and suppliers cannot own solar tasks.' } },
    } })
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan }))
      .resolves.toEqual({ error: 'Client viewers and suppliers cannot own solar tasks.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
})
