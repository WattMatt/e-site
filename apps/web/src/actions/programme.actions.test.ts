import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))

import {
  createProgrammeAction, decideFieldUpdatesAction, deleteBaselineAction, moduleSummaryAction, recalculateProgrammeAction,
  saveBaselineAction, saveProgrammeChangesAction, setActiveBaselineAction, submitFieldUpdateAction,
} from './programme.actions'
import { fakeSupabase, type FakeOptions, type FakeResult } from '@/test/fake-supabase'
import { activityRow, PRJ, PROG, programmeRow, programmeTables, VERSION } from '@/lib/programme/test-fixtures'

const OTHER_PRJ = '44444444-4444-4444-8444-444444444444'
const OFF = 'The programme module is not switched on yet.'
const STALE = 'Someone else changed this programme. Reload to see their version.'
const SAVED: FakeResult = { data: { version: 'v2', ids: { n1: 'uuid-n1' }, deleted: [], tombstoned: [] }, error: null }

function setup(opts: { role?: string | null; solar?: string | null; tables?: FakeOptions['tables']; rpc?: FakeOptions['rpc']; userId?: string | null } = {}) {
  const fake = fakeSupabase({
    userId: opts.userId === undefined ? 'u1' : opts.userId,
    tables: opts.tables ?? programmeTables(),
    rpc: {
      // Answered for the fixture's project ONLY: a gate that asks about any other project is refused.
      user_effective_project_role: (args) => ({ data: args.p_project_id === PRJ ? (opts.role === undefined ? 'project_manager' : opts.role) : null, error: null }),
      solar_access_level: (args) => ({ data: args.p_project_id === PRJ ? (opts.solar === undefined ? 'edit' : opts.solar) : null, error: null }),
      'programme.save_changes': SAVED,
      ...opts.rpc,
    },
  })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
const programmeCalls = <T extends { name: string }>(rpcCalls: T[]): T[] => rpcCalls.filter((c) => c.name.startsWith('programme.'))

const before = process.env.PROGRAMME_ENABLED
beforeEach(() => {
  vi.clearAllMocks()
  process.env.PROGRAMME_ENABLED = 'true'
})
afterEach(() => {
  if (before === undefined) delete process.env.PROGRAMME_ENABLED
  else process.env.PROGRAMME_ENABLED = before
})

describe('the PROGRAMME_ENABLED switch', () => {
  it('off: every action refuses with one sentence and never touches the database', async () => {
    process.env.PROGRAMME_ENABLED = 'false'
    const { rpcCalls, calls, client } = setup()
    const results = await Promise.all([
      createProgrammeAction({ projectId: PRJ, kind: 'project', name: 'X', projectStart: '2026-03-02' }),
      saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }),
      recalculateProgrammeAction({ programmeId: PROG, expectedVersion: VERSION }),
      saveBaselineAction({ programmeId: PROG, name: 'B' }),
      setActiveBaselineAction({ baselineId: 'BL' }),
      deleteBaselineAction({ baselineId: 'BL' }),
      submitFieldUpdateAction({ activityId: 'A', percent: 10 }),
      decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'rejected' }] }),
      moduleSummaryAction({ projectId: PRJ, moduleKey: 'solar' }),
    ])
    for (const r of results) expect(r).toEqual({ ok: false, error: OFF })
    expect(rpcCalls).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(h.createClient).not.toHaveBeenCalled()
  })
})

describe('createProgrammeAction', () => {
  it('a project programme: ORG_WRITE_ROLES gate, then one create_programme call', async () => {
    const { rpcCalls } = setup({ rpc: { 'programme.create_programme': { data: 'new-prog', error: null } } })
    await expect(createProgrammeAction({ projectId: PRJ, kind: 'project', name: 'Main', projectStart: '2026-03-02' }))
      .resolves.toEqual({ ok: true, programmeId: 'new-prog' })
    expect(programmeCalls(rpcCalls)).toEqual([{ name: 'programme.create_programme', args: {
      p_project_id: PRJ, p_kind: 'project', p_name: 'Main', p_project_start: '2026-03-02', p_module_key: null, p_contractor_label: null,
    } }])
  })
  it('a contractor (not a write role) is refused before the database', async () => {
    const { rpcCalls } = setup({ role: 'contractor' })
    const res = await createProgrammeAction({ projectId: PRJ, kind: 'contractor', name: 'Sub', projectStart: '2026-03-02', contractorLabel: 'ACME' })
    expect(res).toEqual({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('a module programme is gated on Solar edit, not the project role', async () => {
    const view = setup({ role: 'owner', solar: 'view' })
    await expect(createProgrammeAction({ projectId: PRJ, kind: 'module', moduleKey: 'solar', name: 'Solar', projectStart: '2026-03-02' }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit this module programme.' })
    expect(programmeCalls(view.rpcCalls)).toHaveLength(0)

    const edit = setup({ role: 'contractor', solar: 'edit', rpc: { 'programme.create_programme': { data: 'sol', error: null } } })
    await expect(createProgrammeAction({ projectId: PRJ, kind: 'module', moduleKey: 'solar', name: 'Solar', projectStart: '2026-03-02' }))
      .resolves.toEqual({ ok: true, programmeId: 'sol' })
    expect(programmeCalls(edit.rpcCalls)[0].args).toMatchObject({ p_kind: 'module', p_module_key: 'solar' })
  })
  it('refuses an unknown kind and a module without a module key', async () => {
    const { rpcCalls } = setup()
    await expect(createProgrammeAction({ projectId: PRJ, kind: 'other' as never, name: 'X', projectStart: '2026-03-02' }))
      .resolves.toEqual({ ok: false, error: 'A programme is a project, module or contractor programme.' })
    await expect(createProgrammeAction({ projectId: PRJ, kind: 'module', name: 'X', projectStart: '2026-03-02' }))
      .resolves.toEqual({ ok: false, error: 'Say which module this programme is for.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('a database refusal comes back as its sentence', async () => {
    setup({ rpc: { 'programme.create_programme': { data: null, error: { code: '23505', message: 'This project already has a project programme.' } } } })
    await expect(createProgrammeAction({ projectId: PRJ, kind: 'project', name: 'Main', projectStart: '2026-03-02' }))
      .resolves.toEqual({ ok: false, error: 'This project already has a project programme.' })
  })
})

describe('saveProgrammeChangesAction', () => {
  const newAct = { op: 'upsert_activity' as const, key: 'n1', fields: { name: 'Cable pull', type: 'task' as const, original_duration: 3 } }
  const link = { op: 'upsert_dependency' as const, key: 'd2', pred: 'B', succ: 'n1' }

  it('happy path: exactly one save_changes call carrying the ops, the version and the computed cache (keys for new rows)', async () => {
    const { rpcCalls } = setup()
    const res = await saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [newAct, link] })
    expect(res).toMatchObject({ ok: true, version: 'v2', ids: { n1: 'uuid-n1' } })
    const saves = programmeCalls(rpcCalls)
    expect(saves).toHaveLength(1)
    expect(saves[0].name).toBe('programme.save_changes')
    const args = saves[0].args as { p_programme_id: string; p_expected_version: string; p_ops: unknown; p_computed: { project_finish: string; activities: Array<Record<string, unknown>> } }
    expect(args.p_programme_id).toBe(PROG)
    expect(args.p_expected_version).toBe(VERSION)
    expect(args.p_ops).toEqual([newAct, link])
    const byRef = new Map(args.p_computed.activities.map((a) => [String(a.id ?? `key:${a.key}`), a]))
    expect([...byRef.keys()].sort()).toEqual(['A', 'B', 'key:n1'])
    expect(byRef.get('key:n1')).toMatchObject({ key: 'n1', early_start: expect.any(String), is_critical: true })
    expect(byRef.get('key:n1')!.id).toBeUndefined()
    expect(args.p_computed.project_finish).toBe(byRef.get('key:n1')!.early_finish)
  })
  it('a keyless new activity is refused before anything is read', async () => {
    const { rpcCalls, calls } = setup()
    const res = await saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [{ op: 'upsert_activity', fields: { name: 'X', type: 'task' } }] })
    expect(res).toEqual({ ok: false, error: 'Give each new activity a key so its schedule can be saved.' })
    expect(calls).toHaveLength(0)
    expect(rpcCalls).toHaveLength(0)
  })
  it('a blank key counts as no key', async () => {
    const { calls } = setup()
    for (const key of ['', '   ']) {
      await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [{ op: 'upsert_activity', key, fields: { name: 'X', type: 'task' } }] }))
        .resolves.toEqual({ ok: false, error: 'Give each new activity a key so its schedule can be saved.' })
    }
    expect(calls).toHaveLength(0)
  })
  it('the gate asks about the programme\'s OWN project (read from the database), not any other', async () => {
    const elsewhere = programmeTables({ 'programme.programmes': [programmeRow({ project_id: OTHER_PRJ })] })
    const { rpcCalls } = setup({ role: 'owner', tables: elsewhere })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'rejected' }] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    await expect(saveBaselineAction({ programmeId: PROG, name: 'B' }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
    const moduleElsewhere = programmeTables({ 'programme.programmes': [programmeRow({ project_id: OTHER_PRJ, kind: 'module', module_key: 'solar' })] })
    setup({ role: 'owner', solar: 'edit', tables: moduleElsewhere })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit this module programme.' })
  })
  it('an engine error (a loop made by the ops) is refused with its message and the issues; save_changes is never called', async () => {
    const { rpcCalls } = setup()
    const res = await saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [{ op: 'upsert_dependency', key: 'loop', pred: 'B', succ: 'A' }] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/loop|cycle/i)
    expect(res.issues?.some((i) => i.code === 'cycle')).toBe(true)
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('an op the database would refuse is refused with the same sentence, before the database', async () => {
    const { rpcCalls } = setup()
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [{ op: 'delete_activity', id: 'GONE' }] }))
      .resolves.toEqual({ ok: false, error: 'That activity no longer exists. Reload to see the current programme.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('the gate: a contractor is refused after the read and before save_changes', async () => {
    const { rpcCalls } = setup({ role: 'contractor' })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('the gate on a module programme is Solar edit', async () => {
    const tables = programmeTables({ 'programme.programmes': [programmeRow({ kind: 'module', module_key: 'solar' })] })
    const view = setup({ role: 'owner', solar: 'view', tables })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit this module programme.' })
    expect(programmeCalls(view.rpcCalls)).toHaveLength(0)
  })
  it('40001 from the database becomes the reload sentence', async () => {
    setup({ rpc: { 'programme.save_changes': { data: null, error: { code: '40001', message: 'could not serialize' } } } })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: STALE })
  })
  it('42501 keeps the database sentence; an unknown error is a generic sentence (no internals)', async () => {
    setup({ rpc: { 'programme.save_changes': { data: null, error: { code: '42501', message: 'You do not have permission to edit this programme.' } } } })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit this programme.' })
    setup({ rpc: { 'programme.save_changes': { data: null, error: { code: 'PGRST202', message: 'Could not find the function programme.save_changes' } } } })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'The programme could not be saved. Try again.' })
  })
  it('a programme the person cannot read is a sentence', async () => {
    setup({ tables: programmeTables({ 'programme.programmes': [] }) })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'That programme no longer exists, or you do not have access to it.' })
  })
  it('refuses a missing sign-in and malformed input without touching the database', async () => {
    const signedOut = setup({ userId: null })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: [] }))
      .resolves.toEqual({ ok: false, error: 'You are not signed in.' })
    expect(signedOut.calls).toHaveLength(0)
    const bad = setup()
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: VERSION, ops: 'x' as never }))
      .resolves.toEqual({ ok: false, error: 'The changes must be sent as a list.' })
    await expect(saveProgrammeChangesAction({ programmeId: PROG, expectedVersion: '', ops: [] }))
      .resolves.toEqual({ ok: false, error: STALE })
    expect(bad.calls).toHaveLength(0)
  })
})

describe('recalculateProgrammeAction', () => {
  it('is a save with no ops: one save_changes call with [] and the fresh cache', async () => {
    const { rpcCalls } = setup()
    await expect(recalculateProgrammeAction({ programmeId: PROG, expectedVersion: VERSION })).resolves.toMatchObject({ ok: true, version: 'v2' })
    const saves = programmeCalls(rpcCalls)
    expect(saves).toHaveLength(1)
    expect(saves[0].args.p_ops).toEqual([])
    const computed = saves[0].args.p_computed as { activities: Array<{ id: string }> }
    expect(computed.activities.map((a) => a.id).sort()).toEqual(['A', 'B'])
  })
})

describe('baselines', () => {
  const tables = () => programmeTables({ 'programme.baselines': [{ id: 'BL', programme_id: PROG, name: 'B0', is_active: false }] })
  it('saveBaselineAction: gate, then save_baseline with the name and the active flag', async () => {
    const { rpcCalls } = setup({ tables: tables(), rpc: { 'programme.save_baseline': { data: 'bl-new', error: null } } })
    await expect(saveBaselineAction({ programmeId: PROG, name: 'Contract', setActive: true })).resolves.toEqual({ ok: true, baselineId: 'bl-new' })
    expect(programmeCalls(rpcCalls)).toEqual([{ name: 'programme.save_baseline', args: { p_programme_id: PROG, p_name: 'Contract', p_set_active: true } }])
  })
  it('setActiveBaselineAction / deleteBaselineAction: gate via the baseline\'s programme, then one call', async () => {
    const a = setup({ tables: tables() })
    await expect(setActiveBaselineAction({ baselineId: 'BL' })).resolves.toEqual({ ok: true })
    await expect(deleteBaselineAction({ baselineId: 'BL' })).resolves.toEqual({ ok: true })
    expect(programmeCalls(a.rpcCalls)).toEqual([
      { name: 'programme.set_active_baseline', args: { p_baseline_id: 'BL' } },
      { name: 'programme.delete_baseline', args: { p_baseline_id: 'BL' } },
    ])
  })
  it('the gate refuses all three before the database', async () => {
    const { rpcCalls } = setup({ role: 'inspector', tables: tables() })
    const refused = { ok: false, error: 'You do not have permission to edit programmes on this project.' }
    await expect(saveBaselineAction({ programmeId: PROG, name: 'B' })).resolves.toEqual(refused)
    await expect(setActiveBaselineAction({ baselineId: 'BL' })).resolves.toEqual(refused)
    await expect(deleteBaselineAction({ baselineId: 'BL' })).resolves.toEqual(refused)
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('a baseline the person cannot see is a sentence', async () => {
    const { rpcCalls } = setup({ tables: tables() })
    await expect(deleteBaselineAction({ baselineId: 'NOPE' })).resolves.toEqual({ ok: false, error: 'That baseline no longer exists.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
})

describe('submitFieldUpdateAction', () => {
  it('sends the report as the person (the database decides who may report)', async () => {
    const { rpcCalls } = setup({ role: 'contractor', rpc: { 'programme.submit_field_update': { data: 'fu-1', error: null } } })
    await expect(submitFieldUpdateAction({ activityId: 'A', start: '2026-03-02', percent: 40, note: 'Started' }))
      .resolves.toEqual({ ok: true, fieldUpdateId: 'fu-1' })
    expect(programmeCalls(rpcCalls)).toEqual([{ name: 'programme.submit_field_update', args: {
      p_activity_id: 'A', p_start: '2026-03-02', p_finish: null, p_percent: 40, p_remaining: null, p_note: 'Started',
    } }])
  })
  it('a refusal comes back as the database sentence', async () => {
    setup({ rpc: { 'programme.submit_field_update': { data: null, error: { code: '42501', message: 'You can only report progress on activities assigned to your company or crew.' } } } })
    await expect(submitFieldUpdateAction({ activityId: 'A', percent: 40 }))
      .resolves.toEqual({ ok: false, error: 'You can only report progress on activities assigned to your company or crew.' })
  })
})

describe('decideFieldUpdatesAction', () => {
  const fu = (id: string, activity_id: string, over: Record<string, unknown> = {}) => ({
    id, programme_id: PROG, activity_id, status: 'reported', reported_start: null, reported_finish: null,
    reported_percent: null, reported_remaining: null, created_at: '2026-03-03T08:00:00+00:00', ...over,
  })
  const withUpdates = (rows: Array<Record<string, unknown>>, extra: Record<string, Array<Record<string, unknown>>> = {}) =>
    programmeTables({ 'programme.field_updates': rows, ...extra })

  const DECIDED = (n: number): FakeResult => ({ data: { version: 'v2', ids: {}, deleted: [], tombstoned: [], decided: n }, error: null })

  it('applied: ONE save_changes call carrying the decision AND the reported values as an activity upsert', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([fu('F1', 'A', { reported_start: '2026-03-02', reported_percent: 50 })]),
      rpc: { 'programme.save_changes': DECIDED(1) },
    })
    const res = await decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'applied' }] })
    expect(res).toMatchObject({ ok: true, decided: 1, version: 'v2' })
    const pc = programmeCalls(rpcCalls)
    expect(pc.map((c) => c.name)).toEqual(['programme.save_changes'])
    expect(pc[0].args.p_decisions).toEqual([{ id: 'F1', status: 'applied', note: null }])
    expect(pc[0].args.p_ops).toEqual([{ op: 'upsert_activity', id: 'A', fields: { actual_start: '2026-03-02', percent_complete: 50 } }])
    expect(pc[0].args.p_expected_version).toBe(VERSION)
    expect(pc[0].args.p_computed).not.toBeNull()
  })
  it('adjusted: the planner\'s values win over the reported ones', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([fu('F1', 'A', { reported_start: '2026-03-02', reported_percent: 50 })]),
      rpc: { 'programme.save_changes': DECIDED(1) },
    })
    await decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'adjusted', percent: 30, note: 'Site walk' }] })
    const pc = programmeCalls(rpcCalls)
    expect(pc[0].args.p_decisions).toEqual([{ id: 'F1', status: 'adjusted', note: 'Site walk' }])
    expect(pc[0].args.p_ops).toEqual([{ op: 'upsert_activity', id: 'A', fields: { actual_start: '2026-03-02', percent_complete: 30 } }])
  })
  it('rejected only: one save_changes call with the decision, no ops and no cache (nothing changes on the programme)', async () => {
    const { rpcCalls } = setup({ tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })]), rpc: { 'programme.save_changes': DECIDED(1) } })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'rejected' }] }))
      .resolves.toEqual({ ok: true, decided: 1, version: 'v2', ids: {}, issues: [] })
    const pc = programmeCalls(rpcCalls)
    expect(pc.map((c) => c.name)).toEqual(['programme.save_changes'])
    expect(pc[0].args).toEqual({
      p_programme_id: PROG, p_expected_version: VERSION, p_ops: [], p_computed: null,
      p_decisions: [{ id: 'F1', status: 'rejected', note: null }],
    })
  })
  it('the agreed values are checked before sending: a removed activity refuses and nothing is sent', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })], { 'programme.activities': [activityRow('A', { is_tombstoned: true }), activityRow('B')] }),
    })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'applied' }] }))
      .resolves.toEqual({ ok: false, error: 'That activity was removed. Restore it first.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('the version is compared as an instant: the same moment in another form is accepted; nonsense is refused', async () => {
    const ok = setup({ tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })]), rpc: { 'programme.save_changes': DECIDED(1) } })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: '2026-11-17T08:00:00.123Z', decisions: [{ id: 'F1', status: 'rejected' }] }))
      .resolves.toMatchObject({ ok: true })
    expect(programmeCalls(ok.rpcCalls)).toHaveLength(1)
    const bad = setup({ tables: withUpdates([fu('F1', 'A')]) })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: 'not a time', decisions: [{ id: 'F1', status: 'rejected' }] }))
      .resolves.toEqual({ ok: false, error: STALE })
    expect(programmeCalls(bad.rpcCalls)).toHaveLength(0)
  })
  it('adjusted: a null value counts as left out (the reported value is used)', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([fu('F1', 'A', { reported_start: '2026-03-02', reported_percent: 50 })]),
      rpc: { 'programme.save_changes': DECIDED(1) },
    })
    await decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'adjusted', percent: null, start: '2026-03-03' }] })
    expect(programmeCalls(rpcCalls)[0].args.p_ops).toEqual([{ op: 'upsert_activity', id: 'A', fields: { actual_start: '2026-03-03', percent_complete: 50 } }])
  })
  it('several reports on one activity apply oldest first, whatever order the decisions arrive in', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([
        fu('F1', 'A', { reported_percent: 20, created_at: '2026-03-03T08:00:00+00:00' }),
        fu('F2', 'A', { reported_percent: 70, created_at: '2026-03-05T08:00:00+00:00' }),
      ]),
      rpc: { 'programme.save_changes': DECIDED(2) },
    })
    await decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F2', status: 'applied' }, { id: 'F1', status: 'applied' }] })
    expect(programmeCalls(rpcCalls)[0].args.p_ops).toEqual([
      { op: 'upsert_activity', id: 'A', fields: { percent_complete: 20 } },
      { op: 'upsert_activity', id: 'A', fields: { percent_complete: 70 } },
    ])
  })
  it('a stale version is refused before sending (early, to the millisecond)', async () => {
    const { rpcCalls } = setup({ tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })]) })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: '2026-01-01T00:00:00+00:00', decisions: [{ id: 'F1', status: 'applied' }] }))
      .resolves.toEqual({ ok: false, error: STALE })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('the gate refuses before the database', async () => {
    const { rpcCalls } = setup({ role: 'contractor', tables: withUpdates([fu('F1', 'A')]) })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'rejected' }] }))
      .resolves.toEqual({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('a stale version at the database (someone saved in between) is the plain reload sentence: nothing was decided', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })]),
      rpc: { 'programme.save_changes': { data: null, error: { code: '40001', message: 'x' } } },
    })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'applied' }] }))
      .resolves.toEqual({ ok: false, error: STALE })
    expect(programmeCalls(rpcCalls).map((c) => c.name)).toEqual(['programme.save_changes'])
  })
  it('a decision refusal is its sentence (one call, so nothing is saved either)', async () => {
    const { rpcCalls } = setup({
      tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })]),
      rpc: { 'programme.save_changes': { data: null, error: { code: '22023', message: 'That field update has already been decided.' } } },
    })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'applied' }] }))
      .resolves.toEqual({ ok: false, error: 'That field update has already been decided.' })
    expect(programmeCalls(rpcCalls).map((c) => c.name)).toEqual(['programme.save_changes'])
  })
  it('a transport failure is the decide fallback sentence', async () => {
    setup({
      tables: withUpdates([fu('F1', 'A', { reported_percent: 50 })]),
      rpc: { 'programme.save_changes': { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } },
    })
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [{ id: 'F1', status: 'rejected' }] }))
      .resolves.toEqual({ ok: false, error: 'The field updates could not be decided. Try again.' })
  })
  it('refuses an empty decision list', async () => {
    const { rpcCalls, calls } = setup()
    await expect(decideFieldUpdatesAction({ programmeId: PROG, expectedVersion: VERSION, decisions: [] }))
      .resolves.toEqual({ ok: false, error: 'Choose at least one field update to decide.' })
    expect(rpcCalls).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
})

describe('moduleSummaryAction', () => {
  it('any project reader but a client viewer gets the three numbers', async () => {
    const { rpcCalls } = setup({ role: 'contractor', rpc: { 'programme.module_summary': { data: [{ start: '2026-03-02', finish: '2026-05-01', percent_complete: 42.5 }], error: null } } })
    await expect(moduleSummaryAction({ projectId: PRJ, moduleKey: 'solar' }))
      .resolves.toEqual({ ok: true, summary: { start: '2026-03-02', finish: '2026-05-01', percentComplete: 42.5 } })
    expect(programmeCalls(rpcCalls)).toEqual([{ name: 'programme.module_summary', args: { p_project_id: PRJ, p_module_key: 'solar' } }])
  })
  it('a client viewer is refused before the database', async () => {
    const { rpcCalls } = setup({ role: 'client_viewer' })
    await expect(moduleSummaryAction({ projectId: PRJ, moduleKey: 'solar' }))
      .resolves.toEqual({ ok: false, error: 'You do not have access to this project.' })
    expect(programmeCalls(rpcCalls)).toHaveLength(0)
  })
  it('no module programme yet: a null summary', async () => {
    setup({ rpc: { 'programme.module_summary': { data: [{ start: null, finish: null, percent_complete: null }], error: null } } })
    await expect(moduleSummaryAction({ projectId: PRJ, moduleKey: 'solar' })).resolves.toEqual({ ok: true, summary: null })
  })
})
