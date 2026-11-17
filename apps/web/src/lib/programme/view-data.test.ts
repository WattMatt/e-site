import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadProgrammeView } from './view-data'
import { PRJ, PROG, VERSION, programmeRow, programmeTables } from './test-fixtures'

const OTHER = '33333333-3333-4333-8333-333333333333'
describe('loadProgrammeView', () => {
  it('no programme: view is null and the list is empty', async () => {
    const { client } = fakeSupabase({ tables: { 'programme.programmes': [] } })
    expect(await loadProgrammeView(client as never, PRJ, {})).toEqual({ ok: true, view: null, programmes: [] })
  })

  it('opens the project programme by default; output is JSON-safe with the active baseline mapped', async () => {
    // baseline_activities for B2
    const withRows = fakeSupabase({
      tables: {
        ...programmeTables({
          'programme.programmes': [programmeRow(), programmeRow({ id: OTHER, kind: 'module', module_key: 'solar', name: 'Solar' })],
          'programme.baseline_activities': [
            { id: 'x1', baseline_id: 'B2', programme_id: PROG, activity_id: 'A', early_start: '2026-03-02', early_finish: '2026-03-03' },
            { id: 'x2', baseline_id: 'B2', programme_id: PROG, activity_id: 'B', early_start: null, early_finish: null },
            { id: 'x3', baseline_id: 'B1', programme_id: PROG, activity_id: 'A', early_start: '2025-01-01', early_finish: '2025-01-02' },
          ],
        }),
        'programme.baselines': [
          { id: 'B1', programme_id: PROG, name: 'Baseline 0', is_active: false, created_at: '2026-11-02T00:00:00Z' },
          { id: 'B2', programme_id: PROG, name: 'Baseline 1', is_active: true, created_at: '2026-11-03T00:00:00Z' },
        ],
      },
    })
    const res = await loadProgrammeView(withRows.client as never, PRJ, {})
    if (!res.ok || !res.view) throw new Error('expected a view')
    expect(res.view.version).toBe(VERSION)
    expect(res.view.state.programme.id).toBe(PROG)
    expect(res.view.baselines.map((b) => b.id)).toEqual(['B1', 'B2'])
    expect(res.view.activeBaseline).toEqual({
      id: 'B2', name: 'Baseline 1',
      activities: { A: { early_start: '2026-03-02', early_finish: '2026-03-03' }, B: { early_start: null, early_finish: null } },
    })
    expect(res.programmes.map((p) => p.id)).toEqual([PROG, OTHER])
    expect(res.programmes[0]).toEqual({ id: PROG, kind: 'project', name: 'Main programme', module_key: null, contractor_label: null })
    expect(JSON.parse(JSON.stringify(res.view))).toEqual(res.view)
  })

  it('no active baseline: activeBaseline is null', async () => {
    const { client } = fakeSupabase({ tables: { ...programmeTables(), 'programme.baselines': [] } })
    const res = await loadProgrammeView(client as never, PRJ, {})
    if (!res.ok || !res.view) throw new Error('expected a view')
    expect(res.view.activeBaseline).toBeNull()
    expect(res.view.baselines).toEqual([])
  })

  it('a selector picks a programme by id or the solar module programme; a foreign id is refused', async () => {
    const tables = {
      ...programmeTables({
        'programme.programmes': [programmeRow(), programmeRow({ id: OTHER, kind: 'module', module_key: 'solar', name: 'Solar' })],
      }),
      'programme.baselines': [],
    }
    const { client } = fakeSupabase({ tables })
    const mod = await loadProgrammeView(client as never, PRJ, { module: 'solar' })
    expect(mod.ok && mod.view?.state.programme.id).toBe(OTHER)
    const unknown = await loadProgrammeView(client as never, PRJ, { programmeId: '99999999-9999-4999-8999-999999999999' })
    expect(unknown.ok).toBe(false)
  })

  it('a read failure is a sentence', async () => {
    const { client } = fakeSupabase({ selectErrors: { 'programme.programmes': { message: 'boom' } } })
    const res = await loadProgrammeView(client as never, PRJ, {})
    expect(res).toEqual({ ok: false, error: expect.any(String) })
  })
})
