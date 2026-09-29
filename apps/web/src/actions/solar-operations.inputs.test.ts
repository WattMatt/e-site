import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P, I, M } from './solar-operations.test-helpers'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit'),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), seed: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  deleteIrradiationAction, linkMeterAction, saveGuaranteeAction, saveIrradiationAction, setMeterShareAction, unlinkMeterAction,
} from './solar-operations.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('meters', () => {
  it('links a meter in a role; the trigger’s refusal is shown in its own words', async () => {
    const f = setup()
    await expect(linkMeterAction({ projectId: P, installationId: I, meterId: M, role: 'generation' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.installation_meters', 'insert')[0]!.payload).toEqual({ installation_id: I, meter_id: M, role: 'generation' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'meter_linked', objectRef: { meterId: M, role: 'generation' } })
    setup({ writes: { 'solar.installation_meters:insert': { error: { code: '23514', message: 'solar.installation_meters: a generation meter must be a solar meter' } } } })
    await expect(linkMeterAction({ projectId: P, installationId: I, meterId: M, role: 'generation' })).resolves.toEqual({ error: 'A generation meter must be a solar meter.' })
  })
  it('refuses an unknown role before any write', async () => {
    const f = setup()
    await expect(linkMeterAction({ projectId: P, installationId: I, meterId: M, role: 'tenant' as never })).resolves.toEqual({ error: 'Unknown meter role.' })
    expect(f.calls).toHaveLength(0)
  })
  it('unlinks and sets a share (null = equal split)', async () => {
    const f = setup({ writes: { 'solar.installation_meters:delete': { data: [{ meter_id: M }] } } })
    await expect(unlinkMeterAction({ projectId: P, installationId: I, meterId: M })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.installation_meters', 'delete')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'meter_id', M], ['eq', 'project_id', P]])
    await expect(setMeterShareAction({ projectId: P, installationId: I, meterId: M, sharePct: 150 })).resolves.toEqual({ error: 'A share is between 0 and 100 %.' })
    await expect(setMeterShareAction({ projectId: P, installationId: I, meterId: M, sharePct: 60 })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.installation_meters', 'update')[0]!.payload).toEqual({ expected_share_pct: 60 })
    expect(callsTo(f.calls, 'solar.installation_meters', 'update')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'meter_id', M], ['eq', 'project_id', P]])
  })
  it('a write that touched no row (another project’s ids, or already gone) says so, with no audit (review A2)', async () => {
    setup({ writes: { 'solar.installation_meters:delete': { data: [] }, 'solar.installation_meters:update': { data: [] } } })
    await expect(unlinkMeterAction({ projectId: P, installationId: I, meterId: M })).resolves.toEqual({ error: 'That meter is not linked to this installation — reload.' })
    await expect(setMeterShareAction({ projectId: P, installationId: I, meterId: M, sharePct: 60 })).resolves.toEqual({ error: 'That meter is not linked to this installation — reload.' })
    setup({ writes: { 'solar.ops_irradiation:delete': { data: [] } } })
    await expect(deleteIrradiationAction({ projectId: P, installationId: I, month: '2026-03' })).resolves.toEqual({ error: 'There is no irradiation entry for that month — reload.' })
    expect(h.audit).not.toHaveBeenCalled()
    expect(h.revalidate).not.toHaveBeenCalled()
  })
})

describe('guarantee', () => {
  it('field errors mirror the database CHECKs; no write', async () => {
    const f = setup()
    const r = await saveGuaranteeAction({ projectId: P, installationId: I, guarantee: { basis: 'pct_of_modelled', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 }, expectedUpdatedAt: 'G1' })
    expect(r).toHaveProperty('fieldErrors.pct')
    expect(f.calls).toHaveLength(0)
  })
  it('updates on the loaded version, or inserts the first one', async () => {
    const f = setup({ writes: { 'solar.guarantees:update': { data: [{ updated_at: 'G2' }] } } })
    const g = { basis: 'manual', pct: null, manualMonthlyKwh: new Array(12).fill(1000), degradationPctPerYear: 0 }
    await expect(saveGuaranteeAction({ projectId: P, installationId: I, guarantee: g, expectedUpdatedAt: 'G1' })).resolves.toEqual({ ok: true, updatedAt: 'G2' })
    expect(callsTo(f.calls, 'solar.guarantees', 'update')[0]!.payload).toEqual({ basis: 'manual', pct: null, manual_monthly_kwh: new Array(12).fill(1000), degradation_pct_per_year: 0 })
    expect(callsTo(f.calls, 'solar.guarantees', 'update')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'project_id', P], ['eq', 'updated_at', 'G1']])
    const f2 = setup({ writes: { 'solar.guarantees:insert': { data: [{ updated_at: 'G1' }] } } })
    await saveGuaranteeAction({ projectId: P, installationId: I, guarantee: { basis: 'p50', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0.5 }, expectedUpdatedAt: null })
    expect(callsTo(f2.calls, 'solar.guarantees', 'insert')[0]!.payload).toMatchObject({ installation_id: I, basis: 'p50' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_guarantee_saved', properties: { basis: 'p50' } })
  })
})

describe('irradiation', () => {
  it('validates month, plane, value and source; replaces the month’s entry', async () => {
    const f = setup({ tables: { 'solar.ops_irradiation': [{ installation_id: I, project_id: P, month: '2026-03-01' }] },
      writes: { 'solar.ops_irradiation:delete': { data: [{ month: '2026-03-01' }] } } })
    await expect(saveIrradiationAction({ projectId: P, installationId: I, month: '2026-3', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station X' }))
      .resolves.toEqual({ fieldErrors: { month: 'Choose a month.' } })
    await expect(saveIrradiationAction({ projectId: P, installationId: I, month: '2026-03', plane: 'poa', kwhPerM2: 500, sourceNote: 'x' }))
      .resolves.toEqual({ fieldErrors: { kwhPerM2: 'Between 0 and 400 kWh/m².', sourceNote: 'Say where the figure comes from (3–300 characters).' } })
    await expect(saveIrradiationAction({ projectId: P, installationId: I, month: '2026-03', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station X' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.ops_irradiation', 'update')[0]!.payload).toEqual({ plane: 'poa', kwh_per_m2: 150, source_note: 'Station X' })
    expect(callsTo(f.calls, 'solar.ops_irradiation', 'update')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'month', '2026-03-01'], ['eq', 'project_id', P]])
    await expect(deleteIrradiationAction({ projectId: P, installationId: I, month: '2026-03' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.ops_irradiation', 'delete')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'month', '2026-03-01'], ['eq', 'project_id', P]])
  })
})
