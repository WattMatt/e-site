import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GENERIC_MODULE_550 as M } from '@esite/shared'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { createLayoutAction, renameLayoutAction, deleteLayoutAction, saveLayoutObjectsAction, duplicateLayoutAction } from './solar-layout.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const RS = '33333333-3333-4333-8333-333333333333'
const L = '44444444-4444-4444-8444-444444444444'
const O = '55555555-5555-4555-8555-555555555555'
const STALE = 'Someone else changed this — reload to see their version.'

const TABLES = {
  'solar.studies': [{ id: 's1', project_id: P }],
  'solar.layouts': [{ id: L, project_id: P, study_id: 's1', name: 'Option A', roof_source_id: RS, module_spec: M, default_tilt_deg: 10, design_t_min_c: -5, design_t_amb_max_c: 35, updated_at: 'T1' }],
  'solar.roof_sources': [{ id: RS, project_id: P, kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, m_per_px: null }],
  'tenants.floor_plans': [{ id: 'fp1', pixels_per_meter: 10 }],
  'tenants.floor_plan_page_scales': [],
  'solar.layout_objects': [],
}
function setup(o: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables: TABLES, ...o })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

const roof = { id: O, kind: 'roof', geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Main', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }

describe('createLayoutAction', () => {
  it('validates the name BEFORE saving, case-insensitively', async () => {
    const { calls } = setup()
    const res = await createLayoutAction({ projectId: P, name: '  option a ', roofSourceId: RS, module: M, defaultTiltDeg: 10 })
    expect(res).toEqual({ fieldErrors: { name: 'A layout with that name already exists.' } })
    expect(callsTo(calls, 'solar.layouts', 'insert')).toHaveLength(0)
  })
  it('refuses a bad module and tilt with field errors', async () => {
    setup()
    const res = await createLayoutAction({ projectId: P, name: 'B', roofSourceId: RS, module: { ...M, powerW: 0 }, defaultTiltDeg: 80 })
    expect(res).toEqual({ fieldErrors: { module: 'The module needs a positive power rating.', defaultTiltDeg: 'Tilt must be between 0° and 60°.' } })
  })
  it('inserts with the module snapshot', async () => {
    const { calls } = setup({ writes: { 'solar.layouts:insert': { data: [{ id: 'new' }] } } })
    await expect(createLayoutAction({ projectId: P, name: 'Option B', roofSourceId: RS, module: M, defaultTiltDeg: 12 })).resolves.toEqual({ ok: true, id: 'new' })
    expect(callsTo(calls, 'solar.layouts', 'insert')[0]!.payload).toEqual({ study_id: 's1', roof_source_id: RS, name: 'Option B', module_spec: M, default_tilt_deg: 12 })
  })
})

describe('renameLayoutAction / deleteLayoutAction', () => {
  it('rename is conditioned on updated_at', async () => {
    setup({ writes: { 'solar.layouts:update': { data: [] } } })
    await expect(renameLayoutAction({ projectId: P, layoutId: L, name: 'X', expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
  })
  it('delete maps a case FK to the spec sentence', async () => {
    setup({ writes: { 'solar.layouts:delete': { error: { code: '23503', message: 'update or delete on table "layouts" violates foreign key constraint "cases_layout_id_fkey" on table "cases"' } } } })
    await expect(deleteLayoutAction({ projectId: P, layoutId: L })).resolves.toEqual({ error: 'Used by a case — change the case first.' })
  })
})

describe('saveLayoutObjectsAction', () => {
  it('refuses a malformed object with its sentence and writes nothing', async () => {
    const { client } = setup()
    const res = await saveLayoutObjectsAction({ projectId: P, layoutId: L, expectedUpdatedAt: 'T1', upserts: [{ ...roof, id: 'bad' }], deletes: [] })
    expect(res).toEqual({ error: 'An object in the layout has an invalid id.' })
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('sends kind/geometry/props only (never a scale) and a server-computed summary', async () => {
    const { client } = setup({ rpc: { solar_save_layout_objects: { data: 'T2', error: null } } })
    const res = await saveLayoutObjectsAction({ projectId: P, layoutId: L, expectedUpdatedAt: 'T1', upserts: [{ ...roof, pixelsPerMeter: 999 }], deletes: [] })
    expect(res).toMatchObject({ ok: true, updatedAt: 'T2' })
    const args = (client.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0]![1]
    expect(args.p_upserts).toEqual([{ id: O, kind: 'roof', geometry: roof.geometry, props: roof.props }])
    expect(args.p_summary).toEqual({ moduleCount: 0, dcKwp: 0, acKw: 0, arraysWithModules: 0, arrayOutsideRoof: false, stringsFail: 0 })
    expect(args.p_expected_updated_at).toBe('T1')
  })
  it('stale maps to the stale sentence', async () => {
    setup({ rpc: { solar_save_layout_objects: { data: null, error: { code: '40001', message: 'solar.layouts: stale layout' } } } })
    await expect(saveLayoutObjectsAction({ projectId: P, layoutId: L, expectedUpdatedAt: 'T0', upserts: [], deletes: [] })).resolves.toEqual({ error: STALE })
  })
})

describe('duplicateLayoutAction', () => {
  it('creates the copy, then saves cloned objects into it', async () => {
    const { client, calls } = setup({
      tables: { ...TABLES, 'solar.layout_objects': [{ id: O, layout_id: L, kind: 'roof', geometry: roof.geometry, props: roof.props, pixels_per_meter: 10 }] },
      writes: { 'solar.layouts:insert': { data: [{ id: 'L2', updated_at: 'U1' }] } },
      rpc: { solar_save_layout_objects: { data: 'U2', error: null } },
    })
    await expect(duplicateLayoutAction({ projectId: P, layoutId: L, name: 'Option A (copy)' })).resolves.toEqual({ ok: true, id: 'L2' })
    expect(callsTo(calls, 'solar.layouts', 'insert')[0]!.payload).toMatchObject({ name: 'Option A (copy)', roof_source_id: RS })
    const args = (client.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0]![1]
    expect(args.p_layout_id).toBe('L2')
    expect((args.p_upserts as Array<{ id: string }>)[0]!.id).not.toBe(O)
  })
})
