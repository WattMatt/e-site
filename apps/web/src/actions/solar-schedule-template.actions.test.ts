import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}),
  getOrgContext: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.getOrgContext }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { applyScheduleTemplateAction, saveOrgScheduleTemplateAction } from './solar-schedule-template.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
  h.getOrgContext.mockResolvedValue({ organisationId: 'o1', userId: 'u1' })
  h.requireRole.mockResolvedValue({ ok: true })
})

describe('applyScheduleTemplateAction', () => {
  it('uses the built-in programme when the org has none, in the project’s duration mode', async () => {
    const { rpcCalls } = setup({
      rpc: { 'solar.schedule_org_template': { data: null, error: null }, 'solar.schedule_create_tasks': { data: { survey: 't1' }, error: null } },
      tables: { 'solar.schedule_settings': [{ project_id: P, duration_mode: 'working', workload_threshold: 2, updated_at: 'S' }] },
    })
    await expect(applyScheduleTemplateAction({ projectId: P, start: '2026-10-03' })).resolves.toEqual({ ok: true, count: DEFAULT_SOLAR_SCHEDULE_TEMPLATE.length })
    const create = rpcCalls.find((c) => c.name === 'solar.schedule_create_tasks')!
    const tasks = create.args.p_tasks as Array<{ start: string }>
    expect(tasks[0].start).toBe('2026-10-05') // Saturday start moves to Monday in working mode
    expect(create.args.p_replace).toBe(false)
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'schedule_template_applied', objectRef: { count: DEFAULT_SOLAR_SCHEDULE_TEMPLATE.length } }))
  })
  it('uses the org’s template when it has a valid one', async () => {
    const items = [{ key: 'x', name: 'Only item', category: 'Design', zone: '', offsetDays: 0, durationDays: 2, isMilestone: false, after: [] }]
    const { rpcCalls } = setup({ rpc: {
      'solar.schedule_org_template': { data: { version: 1, items }, error: null },
      'solar.schedule_create_tasks': { data: { x: 't1' }, error: null },
    } })
    await expect(applyScheduleTemplateAction({ projectId: P, start: '2026-10-01' })).resolves.toEqual({ ok: true, count: 1 })
    expect((rpcCalls[1].args.p_tasks as unknown[]).length).toBe(1)
  })
  it('refuses a start that is not a date', async () => {
    setup()
    await expect(applyScheduleTemplateAction({ projectId: P, start: 'monday' })).resolves.toEqual({ error: 'Choose the date the programme starts.' })
  })
  it('re-checks Edit itself: a lower level never reaches the database', async () => {
    const { rpcCalls } = setup()
    h.requireSolarLevel.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(applyScheduleTemplateAction({ projectId: P, start: '2026-10-01' })).rejects.toThrow('NEXT_REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(rpcCalls).toHaveLength(0)
  })
  it('turns a database refusal into a sentence and writes no audit row', async () => {
    setup({ rpc: {
      'solar.schedule_org_template': { data: null, error: null },
      'solar.schedule_create_tasks': { data: null, error: { code: '42501', message: 'permission denied for function' } },
    } })
    await expect(applyScheduleTemplateAction({ projectId: P, start: '2026-10-01' }))
      .resolves.toEqual({ error: 'You need Edit access to Solar on this project to change the schedule.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
})

describe('saveOrgScheduleTemplateAction', () => {
  it('owner/admin only', async () => {
    const { calls } = setup()
    h.requireRole.mockResolvedValue({ ok: false })
    await expect(saveOrgScheduleTemplateAction({ items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change the schedule template.' })
    expect(calls).toHaveLength(0)
  })
  it('validates, then inserts { version, items }', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_templates:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveOrgScheduleTemplateAction({ items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE, expectedUpdatedAt: null })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.schedule_templates', 'insert')[0].payload)
      .toEqual({ organisation_id: 'o1', content: { version: 1, items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE } })
    await expect(saveOrgScheduleTemplateAction({ items: [], expectedUpdatedAt: null })).resolves.toEqual({ error: 'The template needs at least one item.' })
  })
  it('updates against the version it was read at; zero rows is stale', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_templates:update': { data: [] } } })
    await expect(saveOrgScheduleTemplateAction({ items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE_MESSAGE })
    expect(callsTo(calls, 'solar.schedule_templates', 'update')[0].filters).toEqual([['eq', 'organisation_id', 'o1'], ['eq', 'updated_at', 'T0']])
  })
  it('refuses an invalid template with its first sentence', async () => {
    setup()
    const bad = [{ ...DEFAULT_SOLAR_SCHEDULE_TEMPLATE[0], after: [{ key: 'nope', type: 'FS' as const, lagDays: 0 }] }]
    await expect(saveOrgScheduleTemplateAction({ items: bad, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Item "survey" follows "nope", which is not in the template.' })
  })
})
