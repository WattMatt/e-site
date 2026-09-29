import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { loadScheduleData, SCHEDULE_LOAD_ERROR, FORMER_MEMBER, PROJECT_MEMBER } from './loader'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = 'p1'
function fake() {
  return fakeSupabase({
    userId: 'u1',
    tables: {
      'projects.projects': [{ id: P, name: 'KINGSWALK' }],
      'solar.schedule_tasks': [
        { id: 't1', project_id: P, work_item_id: 'w1', category: 'Design', zone: '', start_date: '2026-10-01', end_date: '2026-10-05', progress: 20, colour: '#3b82f6', sort_order: 1, is_milestone: false, gantt_status: 'in_progress', description: '', updated_at: 'U1' },
        { id: 't2', project_id: P, work_item_id: 'w2', category: '', zone: '', start_date: '2026-10-06', end_date: '2026-10-06', progress: 0, colour: '#ef4444', sort_order: 2, is_milestone: true, gantt_status: 'not_started', description: 'x', updated_at: 'U2' },
        { id: 't3', project_id: P, work_item_id: 'w3', category: '', zone: '', start_date: '2026-10-07', end_date: '2026-10-09', progress: 0, colour: '#3b82f6', sort_order: 3, is_milestone: false, gantt_status: 'done', description: '', updated_at: 'U3' },
        { id: 't4', project_id: P, work_item_id: 'w4', category: '', zone: '', start_date: '2026-10-10', end_date: '2026-10-12', progress: 0, colour: '#3b82f6', sort_order: 4, is_milestone: false, gantt_status: 'not_started', description: '', updated_at: 'U4' },
      ],
      'projects.work_items': [
        { id: 'w1', project_id: P, item_type: 'solar_task', ref: 'SOLAR-1', title: 'Design', status: 'open', assignee_id: 'u1', gatekeeper_id: 'u5' },
        { id: 'w2', project_id: P, item_type: 'solar_task', ref: 'SOLAR-2', title: 'SSEG submitted', status: 'closed', assignee_id: 'u9' },
        { id: 'w3', project_id: P, item_type: 'solar_task', ref: 'SOLAR-3', title: 'Removed', status: 'void', assignee_id: 'u1' },
        // Owned before Cas became a client viewer: still named on the bar, never offered in the picker.
        { id: 'w4', project_id: P, item_type: 'solar_task', ref: 'SOLAR-4', title: 'Trenching', status: 'open', assignee_id: 'u7' },
      ],
      // Members the picker must NOT offer (Q4): a client viewer and a supplier.
      'projects.project_members': [
        { project_id: P, user_id: 'u1', role: 'contractor', is_active: true },
        { project_id: P, user_id: 'u7', role: 'client_viewer', is_active: true },
        { project_id: P, user_id: 'u8', role: 'supplier', is_active: true },
      ],
      'public.profiles': [
        { id: 'u1', full_name: 'Ann Smith', email: 'ann@x.co.za' },
        { id: 'u7', full_name: 'Cas Client', email: 'cas@client.co.za' },
        { id: 'u8', full_name: 'Sam Supplier', email: 'sam@supplier.co.za' },
      ],
      'solar.schedule_segments': [{ id: 's1', project_id: P, task_id: 't1', start_date: '2026-10-01', end_date: '2026-10-02' }, { id: 's2', project_id: P, task_id: 't1', start_date: '2026-10-04', end_date: '2026-10-05' }],
      'solar.schedule_dependencies': [
        { id: 'd1', project_id: P, predecessor_task_id: 't1', successor_task_id: 't2', link_type: 'FS', lag_days: 1 },
        // Points at the voided task: dropped with it.
        { id: 'd2', project_id: P, predecessor_task_id: 't2', successor_task_id: 't3', link_type: 'FS', lag_days: 0 },
      ],
      'solar.schedule_baselines': [{ id: 'b1', project_id: P, name: 'Contract', description: null, created_at: 'C', duration_mode: 'working' }],
      'solar.schedule_settings': [],
      'solar.schedule_filter_presets': [{ id: 'f1', project_id: P, name: 'Mine', filters: { search: '', statuses: ['done'], ownerIds: [], colours: [] } },
        { id: 'f2', project_id: P, name: 'Broken', filters: { search: 3 } }],
    },
    // The eligible-candidates RPC (00213) already excludes client viewers and suppliers.
    rpc: { 'solar.schedule_owner_candidates': { data: [{ user_id: 'u1', full_name: 'Ann Smith', email: 'ann@x.co.za' }], error: null } },
  })
}

describe('loadScheduleData', () => {
  it('joins side rows to their work items, maps status, drops void, names owners', async () => {
    const { client } = fake()
    const d = await loadScheduleData(P, client as never, 'edit', '2026-09-28')
    expect(d.projectName).toBe('KINGSWALK')
    expect(d.canEdit).toBe(true)
    expect(d.currentUserId).toBe('u1')
    expect(d.tasks.map((t) => [t.id, t.ref, t.name, t.status, t.ownerName])).toEqual([
      ['t1', 'SOLAR-1', 'Design', 'in_progress', 'Ann Smith'],
      ['t2', 'SOLAR-2', 'SSEG submitted', 'done', 'Former project member'],
      ['t4', 'SOLAR-4', 'Trenching', 'not_started', 'Cas Client'],
    ])
    expect(d.tasks[0].segments).toEqual([{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-04', end: '2026-10-05' }])
    expect(d.tasks[1].isMilestone).toBe(true)
    expect(d.tasks.map((t) => t.gatekeeperId)).toEqual(['u5', null, null])
    expect(d.links).toEqual([{ id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 1 }])
    expect(d.settings).toEqual({ durationMode: 'calendar', workloadThreshold: 2, updatedAt: null })
    expect(d.presets).toEqual([{ id: 'f1', name: 'Mine', filters: { search: '', statuses: ['done'], ownerIds: [], colours: [] } }])
    expect(d.baselines).toEqual([{ id: 'b1', name: 'Contract', description: null, createdAt: 'C', durationMode: 'working' }])
    expect(d.today).toBe('2026-09-28')
  })

  it('offers only Solar-eligible owners: never a client viewer or a supplier (Q4)', async () => {
    const { client, rpcCalls } = fake()
    const d = await loadScheduleData(P, client as never, 'edit', '2026-09-28')
    expect(rpcCalls).toEqual([{ name: 'solar.schedule_owner_candidates', args: { p_project_id: P } }])
    expect(d.owners).toEqual([{ id: 'u1', name: 'Ann Smith', email: 'ann@x.co.za' }])
    const offered = d.owners.map((o) => o.id)
    expect(offered).not.toContain('u7')
    expect(offered).not.toContain('u8')
  })

  it('an eligible owner with no name is labelled, never blank (View users get no email)', async () => {
    const f = fakeSupabase({
      userId: 'u2',
      tables: {
        'solar.schedule_tasks': [{ id: 't1', project_id: P, work_item_id: 'w1', category: '', zone: '', start_date: '2026-10-01', end_date: '2026-10-02', progress: 0, colour: '#3b82f6', sort_order: 1, is_milestone: false, gantt_status: 'not_started', description: '', updated_at: 'U' }],
        'projects.work_items': [{ id: 'w1', project_id: P, item_type: 'solar_task', ref: 'SOLAR-1', title: 'Design', status: 'open', assignee_id: 'u1' }],
      },
      rpc: { 'solar.schedule_owner_candidates': { data: [{ user_id: 'u1', full_name: '', email: null }], error: null } },
    })
    const d = await loadScheduleData(P, f.client as never, 'view', '2026-09-28')
    expect(d.tasks[0].ownerName).toBe(PROJECT_MEMBER)
    expect(d.owners).toEqual([{ id: 'u1', name: PROJECT_MEMBER, email: '' }])
  })

  it('the display-name fallback for an ineligible owner never uses an email address', async () => {
    const f = fakeSupabase({
      userId: 'u2',
      tables: {
        'solar.schedule_tasks': [{ id: 't1', project_id: P, work_item_id: 'w1', category: '', zone: '', start_date: '2026-10-01', end_date: '2026-10-02', progress: 0, colour: '#3b82f6', sort_order: 1, is_milestone: false, gantt_status: 'not_started', description: '', updated_at: 'U' }],
        'projects.work_items': [{ id: 'w1', project_id: P, item_type: 'solar_task', ref: 'SOLAR-1', title: 'Design', status: 'open', assignee_id: 'u7' }],
        'public.profiles': [{ id: 'u7', full_name: '', email: 'cas@client.co.za' }],
      },
      rpc: { 'solar.schedule_owner_candidates': { data: [], error: null } },
    })
    const d = await loadScheduleData(P, f.client as never, 'view', '2026-09-28')
    expect(d.tasks[0].ownerName).toBe(FORMER_MEMBER)
  })

  it('stored settings win over the defaults (per-project working mode and threshold)', async () => {
    const f = fakeSupabase({
      userId: 'u1',
      tables: { 'solar.schedule_settings': [{ project_id: P, duration_mode: 'working', workload_threshold: 4, updated_at: 'S1' }] },
    })
    const d = await loadScheduleData(P, f.client as never, 'view', '2026-09-28')
    expect(d.settings).toEqual({ durationMode: 'working', workloadThreshold: 4, updatedAt: 'S1' })
    expect(d.tasks).toEqual([])
    expect(d.owners).toEqual([])
  })

  it('View level cannot edit', async () => {
    const { client } = fake()
    expect((await loadScheduleData(P, client as never, 'view', '2026-09-28')).canEdit).toBe(false)
  })

  it('reads work items by project and type, never by a giant id list', async () => {
    const { client, calls } = fake()
    await loadScheduleData(P, client as never, 'edit', '2026-09-28')
    const wi = callsTo(calls, 'projects.work_items', 'select')
    expect(wi.length).toBeGreaterThan(0)
    for (const c of wi) {
      expect(c.filters.some(([op]) => op === 'in')).toBe(false)
      expect(c.filters).toEqual(expect.arrayContaining([['eq', 'project_id', P], ['eq', 'item_type', 'solar_task']]))
    }
  })

  it('pages past PostgREST max_rows: 1,500 tasks, segments and links all load', async () => {
    const N = 1500
    const ids = Array.from({ length: N }, (_, i) => i)
    const f = fakeSupabase({
      userId: 'u1',
      maxRows: 1000,
      tables: {
        'solar.schedule_tasks': ids.map((i) => ({ id: `t${i}`, project_id: P, work_item_id: `w${i}`, category: '', zone: '', start_date: '2026-10-01', end_date: '2026-10-02', progress: 0, colour: '#3b82f6', sort_order: i, is_milestone: false, gantt_status: 'not_started', description: '', updated_at: 'U' })),
        'projects.work_items': ids.map((i) => ({ id: `w${i}`, project_id: P, item_type: 'solar_task', ref: `SOLAR-${i}`, title: `T${i}`, status: 'open', assignee_id: 'u1' })),
        'solar.schedule_segments': ids.flatMap((i) => [
          { id: `s${i}a`, project_id: P, task_id: `t${i}`, start_date: '2026-10-01', end_date: '2026-10-01' },
          { id: `s${i}b`, project_id: P, task_id: `t${i}`, start_date: '2026-10-02', end_date: '2026-10-02' },
        ]),
        'solar.schedule_dependencies': ids.slice(1).map((i) => ({ id: `d${i}`, project_id: P, predecessor_task_id: `t${i - 1}`, successor_task_id: `t${i}`, link_type: 'FS', lag_days: 0 })),
      },
      rpc: { 'solar.schedule_owner_candidates': { data: [{ user_id: 'u1', full_name: 'Ann Smith', email: 'ann@x.co.za' }], error: null } },
    })
    const d = await loadScheduleData(P, f.client as never, 'edit', '2026-09-28')
    expect(d.tasks).toHaveLength(N)
    expect(d.tasks.every((t) => t.segments.length === 2)).toBe(true)
    expect(d.links).toHaveLength(N - 1)
  })

  for (const table of ['solar.schedule_tasks', 'projects.work_items', 'solar.schedule_segments', 'solar.schedule_dependencies', 'solar.schedule_baselines', 'solar.schedule_settings', 'solar.schedule_filter_presets', 'projects.projects', 'public.profiles']) {
    it(`a failed read of ${table} is a sentence, never an empty schedule`, async () => {
      const f = fakeSupabase({
        userId: 'u1',
        tables: {
          'solar.schedule_tasks': [{ id: 't1', project_id: P, work_item_id: 'w1', category: '', zone: '', start_date: '2026-10-01', end_date: '2026-10-02', progress: 0, colour: '#3b82f6', sort_order: 1, is_milestone: false, gantt_status: 'not_started', description: '', updated_at: 'U' }],
          'projects.work_items': [{ id: 'w1', project_id: P, item_type: 'solar_task', ref: 'SOLAR-1', title: 'T', status: 'open', assignee_id: 'u9' }],
        },
        selectErrors: { [table]: { message: 'upstream request timeout' } },
      })
      await expect(loadScheduleData(P, f.client as never, 'edit', '2026-09-28')).rejects.toThrow(SCHEDULE_LOAD_ERROR)
    })
  }

  it('a failed owner-candidates read is a sentence too', async () => {
    const f = fakeSupabase({ userId: 'u1', rpc: { 'solar.schedule_owner_candidates': { data: null, error: { message: 'boom' } } } })
    await expect(loadScheduleData(P, f.client as never, 'edit', '2026-09-28')).rejects.toThrow(SCHEDULE_LOAD_ERROR)
  })
})
