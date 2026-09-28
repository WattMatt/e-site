import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { addDrawingRoofSourceAction, removeRoofSourceAction, setRoofNorthAction } from './solar-roof-sources.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const FP = '22222222-2222-4222-8222-222222222222'
const RS = '33333333-3333-4333-8333-333333333333'

function setup(o: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables: { 'solar.studies': [{ id: 's1', project_id: P }] }, ...o })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('addDrawingRoofSourceAction', () => {
  it('re-checks Edit and inserts through the session (the trigger stamps the anchor)', async () => {
    const { calls } = setup({ writes: { 'solar.roof_sources:insert': { data: [{ id: RS }] } } })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 2 })).resolves.toEqual({ ok: true, id: RS })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(calls, 'solar.roof_sources', 'insert')[0]!.payload).toEqual({ study_id: 's1', kind: 'drawing', floor_plan_id: FP, page_index: 2 })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'roof_source_added', objectRef: { roofSourceId: RS } })
  })
  it('needs a study first', async () => {
    setup({ tables: {} })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 1 })).resolves.toEqual({ error: 'Save the site location in Site & Supply first.' })
  })
  it('refuses a malformed body with a sentence', async () => {
    setup()
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: 'x', pageIndex: 1 })).resolves.toEqual({ error: 'Choose a drawing.' })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 0 })).resolves.toEqual({ error: 'The page must be 1 or more.' })
  })
  it('maps a duplicate page', async () => {
    setup({ writes: { 'solar.roof_sources:insert': { error: { code: '23505', message: 'duplicate key value violates unique constraint "roof_sources_drawing_page_key"' } } } })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 1 })).resolves.toEqual({ error: 'That drawing page is already a roof source.' })
  })
})

describe('removeRoofSourceAction', () => {
  it('refuses when a layout uses it', async () => {
    setup({ writes: { 'solar.roof_sources:delete': { error: { code: '23503', message: 'update or delete on table "roof_sources" violates foreign key constraint "layouts_roof_source_id_fkey" on table "layouts"' } } } })
    await expect(removeRoofSourceAction({ projectId: P, roofSourceId: RS })).resolves.toEqual({ error: 'This roof source is used by a layout — delete the layout first.' })
  })
  it('reports when nothing was removed', async () => {
    setup({ writes: { 'solar.roof_sources:delete': { data: [] } } })
    await expect(removeRoofSourceAction({ projectId: P, roofSourceId: RS })).resolves.toEqual({ error: 'Nothing was removed — reload to see the current list.' })
  })
})

describe('setRoofNorthAction', () => {
  it('normalises the bearing and conditions on updated_at', async () => {
    const { calls } = setup({ writes: { 'solar.roof_sources:update': { data: [{ updated_at: 'T2' }] } } })
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: -30, points: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'T2', bearingDeg: 330 })
    const c = callsTo(calls, 'solar.roof_sources', 'update')[0]!
    expect(c.payload).toEqual({ north_bearing_deg: 330, north_points: null })
    expect(c.filters).toEqual(expect.arrayContaining([['eq', 'id', RS], ['eq', 'project_id', P], ['eq', 'updated_at', 'T1']]))
  })
  it('stale when someone changed it', async () => {
    setup({ writes: { 'solar.roof_sources:update': { data: [] } } })
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: 0, points: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
  it('refuses a non-number bearing and bad points', async () => {
    setup()
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: Number.NaN, points: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'Enter north as degrees clockwise from the top of the sheet.' })
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: 1, points: [1, 2, 3], expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'North is two points on the sheet.' })
  })
})
