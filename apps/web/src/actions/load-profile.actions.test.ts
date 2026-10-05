import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const P = '11111111-2222-3333-4444-555555555555'
const PROFILE = '99999999-2222-3333-4444-555555555555'
const SHA = 'a'.repeat(64)
const state: { role: string | null; tables: Record<string, Array<Record<string, unknown>>>; removed: string[][]; writes: Record<string, { data: unknown }> } = { role: 'admin', tables: {}, removed: [], writes: {} }
let fake: ReturnType<typeof fakeSupabase>

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    fake = fakeSupabase({ userId: 'u1', rpc: { user_effective_project_role: { data: state.role, error: null } }, tables: state.tables, writes: state.writes })
    return Object.assign(fake.client, { storage: { from: () => ({ remove: async (paths: string[]) => { state.removed.push(paths); return { error: null } } }) } })
  },
}))
const row = (column: string, n: number) => ({
  kind: 'meter', label: column, file_path: `${P}/${SHA}.csv`, file_name: 'm.csv', file_sha256: SHA, format: 'B', source_column: column, kva_column: null,
  interval_min: 30, first_ts_end: '2025-01-01T00:00:00.000Z', values: Array(n).fill(1), quality: Array(n).fill(0), kva_values: null,
  conversion: 'kW as recorded', quality_report: { slots: n }, parser_version: '3a.1',
})
const built = vi.fn()
vi.mock('@/lib/load-profile/pipeline', () => ({ buildMeterRows: (...a: unknown[]) => built(...a), parseStoredFile: vi.fn() }))

const A = await import('./load-profile.actions')
const input = { path: `${P}/${SHA}.csv`, fileName: 'm.csv', sheet: null, selections: [{ column: 'P', label: 'Bulk', withKva: false }] }
const writes = () => fake.calls.filter((c) => c.op !== 'select')

beforeEach(() => {
  state.role = 'admin'
  state.removed = []
  state.writes = {}
  state.tables = { 'projects.load_profiles': [{ id: PROFILE, project_id: P }], 'projects.load_profile_sources': [] }
  built.mockReset().mockResolvedValue({ ok: true, rows: [row('P', 10)], warnings: [] })
})

describe('commitLoadProfileFileAction', () => {
  it('a contractor is refused before anything is parsed or written', async () => {
    state.role = 'contractor'
    expect(await A.commitLoadProfileFileAction(P, input)).toEqual({ error: 'Your role (contractor) is not allowed to perform this action' })
    expect(built).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })
  it('a new channel is inserted with the profile id; parents are left to the trigger', async () => {
    const r = await A.commitLoadProfileFileAction(P, input)
    expect(r).toEqual({ ok: true, imported: 1, replaced: 0, warnings: [] })
    const ins = writes()
    expect(ins).toHaveLength(1)
    expect(ins[0]).toMatchObject({ table: 'projects.load_profile_sources', op: 'insert' })
    expect(ins[0].payload).toMatchObject({ profile_id: PROFILE, source_column: 'P' })
    expect(ins[0].payload).not.toHaveProperty('project_id')
  })
  it('re-importing the same file + column replaces it instead of duplicating', async () => {
    state.tables['projects.load_profile_sources'] = [{ id: 's1', profile_id: PROFILE, kind: 'meter', file_sha256: SHA, source_column: 'P', slots: '10' }]
    const r = await A.commitLoadProfileFileAction(P, input)
    expect(r).toEqual({ ok: true, imported: 0, replaced: 1, warnings: [] })
    expect(writes().map((w) => w.op)).toEqual(['update'])
  })
  it('refuses an import that would take the profile over the size cap, writing nothing', async () => {
    state.tables['projects.load_profile_sources'] = [{ id: 's1', profile_id: PROFILE, kind: 'meter', file_sha256: 'b'.repeat(64), source_column: 'X', slots: String(A.MAX_PROFILE_SLOTS - 5) }]
    const r = await A.commitLoadProfileFileAction(P, input)
    expect('error' in r && r.error).toMatch(/at most 1\s000\s000/)
    expect(writes()).toEqual([])
  })
  it('names the field that failed validation', async () => {
    expect(await A.commitLoadProfileFileAction(P, { ...input, selections: [{ column: 'P', label: 'x'.repeat(201), withKva: false }] }))
      .toEqual({ error: 'A label can be at most 200 characters.' })
  })
})

describe('deleteLoadProfileSourceAction', () => {
  const S = '77777777-2222-3333-4444-555555555555'
  it('removes the raw file once no source of the project points at it', async () => {
    state.writes = { 'projects.load_profile_sources:delete': { data: [{ file_path: `${P}/${SHA}.csv` }] } }
    expect(await A.deleteLoadProfileSourceAction(P, S)).toEqual({ ok: true })
    expect(state.removed).toEqual([[`${P}/${SHA}.csv`]])
  })
  it('keeps the raw file while another channel of it remains', async () => {
    state.tables['projects.load_profile_sources'] = [{ id: 'other', project_id: P, file_path: `${P}/${SHA}.csv` }]
    state.writes = { 'projects.load_profile_sources:delete': { data: [{ file_path: `${P}/${SHA}.csv` }] } }
    expect(await A.deleteLoadProfileSourceAction(P, S)).toEqual({ ok: true })
    expect(state.removed).toEqual([])
  })
  it('a source of another project deletes nothing and says so', async () => {
    state.writes = { 'projects.load_profile_sources:delete': { data: [] } }
    expect(await A.deleteLoadProfileSourceAction(P, S)).toEqual({ error: 'That source is not in this project.' })
    expect(state.removed).toEqual([])
  })
})

describe('tariff pickers', () => {
  it('are for the roles that can choose a tariff', async () => {
    state.role = 'inspector'
    expect(await A.listPublishedLicenseesAction(P)).toEqual({ error: 'Your role (inspector) is not allowed to perform this action' })
  })
})
