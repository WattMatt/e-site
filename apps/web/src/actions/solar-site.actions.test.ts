import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EMPTY_SITE_SUPPLY_FORM } from '@esite/shared'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  audit: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveSolarSiteAction } from './solar-site.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = 'p1'
const U = 'user-1'
const STALE = 'Someone else changed this — reload to see their version.'
const form = { ...EMPTY_SITE_SUPPLY_FORM, latitude: '-26.1', longitude: '28.05', licenseeName: 'City Power', nmdKva: '500' }

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: U, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('saveSolarSiteAction', () => {
  it('re-checks Edit level itself (a View user is redirected to the locked screen)', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: null })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })

  it('returns field errors without writing', async () => {
    const { calls } = setup()
    const res = await saveSolarSiteAction({ projectId: P, form: { ...form, latitude: '-95' }, expectedUpdatedAt: null })
    expect(res).toEqual({ fieldErrors: { latitude: 'Latitude must be between -90 and 90' } })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('first save inserts the study and records audit + product event', async () => {
    const { calls } = setup({ writes: { 'solar.studies:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: null })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.studies', 'insert')[0].payload).toMatchObject({
      project_id: P, latitude: -26.1, longitude: 28.05, licensee_name: 'City Power', nmd_kva: 500,
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'site_saved' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_site_saved' })
    expect(h.revalidate).toHaveBeenCalledWith(`/projects/${P}/solar`, 'layout')
  })

  it('a second first-save (someone created the study meanwhile) is stale', async () => {
    setup({ writes: { 'solar.studies:insert': { error: { code: '23505', message: 'duplicate key' } } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: null })).resolves.toEqual({ error: STALE })
  })

  it('later saves update only if updated_at still matches', async () => {
    const { calls } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: 'T1' })).resolves.toEqual({ ok: true, updatedAt: 'T2' })
    expect(callsTo(calls, 'solar.studies', 'update')[0].filters).toEqual(expect.arrayContaining([['eq', 'project_id', P], ['eq', 'updated_at', 'T1']]))
  })

  it('0 rows updated → stale, nothing recorded', async () => {
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('a point-of-connection board from another project is a sentence, not a raw error', async () => {
    setup({ writes: { 'solar.studies:update': { error: { code: '23514', message: 'solar.studies: point-of-connection node belongs to another project' } } } })
    await expect(saveSolarSiteAction({ projectId: P, form: { ...form, pocNodeId: 'n-x' }, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'That board belongs to another project.' })
  })

  // Review minor: a direct call with a malformed form must get a sentence, not a 500.
  it('a form with missing or non-string fields is coerced, never throws', async () => {
    setup({ writes: { 'solar.studies:insert': { data: [{ updated_at: 'T1' }] } } })
    const res = await saveSolarSiteAction({ projectId: P, form: { latitude: -26.1, longitude: 28.05 } as never, expectedUpdatedAt: null })
    expect(res).toEqual({ ok: true, updatedAt: 'T1' })
  })
})
