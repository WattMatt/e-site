import { describe, it, expect, vi, beforeEach } from 'vitest'
import { solarOrgSettingDefaults, solarSettingsToForm } from '@esite/shared'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  getOrgContext: vi.fn(),
  requireRole: vi.fn(),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.getOrgContext }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveSolarOrgSettingsAction } from './solar-settings.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const ORG = 'org-1'
const U = 'admin-1'
const STALE = 'Someone else changed this — reload to see their version.'
const form = solarSettingsToForm(solarOrgSettingDefaults())

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: U, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getOrgContext.mockResolvedValue({ userId: U, organisationId: ORG, role: 'admin' })
  h.requireRole.mockResolvedValue({ ok: true, role: 'admin' })
})

describe('saveSolarOrgSettingsAction', () => {
  it('re-checks owner/admin on the active org (requireRole returns an object — test .ok)', async () => {
    const { calls } = setup()
    h.requireRole.mockResolvedValueOnce({ ok: false, error: 'nope' })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change Solar defaults.' })
    expect(h.requireRole).toHaveBeenCalledWith(expect.anything(), ORG, ['owner', 'admin'])
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('returns field errors without writing', async () => {
    setup()
    await expect(saveSolarOrgSettingsAction({ form: { ...form, cpi_pct: 'x' }, expectedUpdatedAt: null }))
      .resolves.toEqual({ fieldErrors: { cpi_pct: 'Enter a number' } })
  })

  it('first save inserts { version, values } for the active org', async () => {
    const { calls } = setup({ writes: { 'solar.org_settings:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: null })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.org_settings', 'insert')[0].payload).toEqual({
      organisation_id: ORG, version: 1, settings: { version: 1, values: solarOrgSettingDefaults() },
    })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: null, organisationId: ORG, event: 'solar_settings_saved' })
    expect(h.revalidate).toHaveBeenCalledWith('/settings/solar')
  })

  it('later saves are conditioned on updated_at; 0 rows → stale', async () => {
    const { calls } = setup({ writes: { 'solar.org_settings:update': { data: [] } } })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.org_settings', 'update')[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'organisation_id', ORG], ['eq', 'updated_at', 'T0'],
    ]))
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('a concurrent first save is stale', async () => {
    setup({ writes: { 'solar.org_settings:insert': { error: { code: '23505', message: 'duplicate' } } } })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: null })).resolves.toEqual({ error: STALE })
  })
})
