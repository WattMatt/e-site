import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P, I } from './solar-operations.test-helpers'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit'),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), seed: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/operations/baseline-loader', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/operations/baseline-loader')>()), loadInstallationSeed: h.seed }))

import { createInstallationAction, saveInstallationAction } from './solar-operations.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { INSTALL_REASONS } from '@/lib/solar/operations/baseline-loader'

const asBuilt = { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
  equipment: [{ kind: 'module', make: 'A', model: 'M', rating: 500, unit: 'W', quantity: 200 }] }
const baseline = { version: 1 }

let svc: ReturnType<typeof fakeSupabase>
function setup(extra: Parameters<typeof fakeSupabase>[0] = {}, svcOpts: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1' }], 'solar.handover_templates': [] }, ...extra })
  h.createClient.mockResolvedValue(f.client)
  svc = fakeSupabase({ userId: null, writes: { 'solar.installations:insert': { data: [{ id: I }] } }, ...svcOpts })
  h.createServiceClient.mockReturnValue(svc.client as never)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
  h.seed.mockResolvedValue({ ok: true, proposalId: 'prop-1', baseline, asBuilt, degradationPctPerYear: 0.45 })
})

describe('createInstallationAction', () => {
  it('gates Edit FIRST, inserts the installation with the SERVICE role (00217 refuses a session insert) naming the caller, then a P50 guarantee and the default checklist', async () => {
    const f = setup()
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ ok: true, installationId: I, warning: null })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(h.requireSolarLevel.mock.invocationCallOrder[0]!).toBeLessThan(h.createServiceClient.mock.invocationCallOrder[0]!)
    expect(callsTo(f.calls, 'solar.installations', 'insert')).toHaveLength(0)
    expect(callsTo(svc.calls, 'solar.installations', 'insert')[0]!.payload)
      .toEqual({ study_id: 's1', proposal_id: 'prop-1', baseline, as_built: asBuilt, created_by: 'u1', updated_by: 'u1' })
    expect(callsTo(f.calls, 'solar.guarantees', 'insert')[0]!.payload).toEqual({ installation_id: I, basis: 'p50', degradation_pct_per_year: 0.45 })
    const items = callsTo(f.calls, 'solar.handover_items', 'insert')[0]!.payload as Array<Record<string, unknown>>
    expect(items[0]).toEqual({ installation_id: I, item_key: 'coc', label: 'Certificate of Compliance (CoC)', required: true, sort_order: 0 })
    expect(items).toHaveLength(9)
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'installation_created', objectRef: { installationId: I, proposalId: 'prop-1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_installation_saved', properties: { action: 'created' } })
  })
  it('passes the seed’s reason through and writes nothing', async () => {
    const f = setup()
    h.seed.mockResolvedValue({ ok: false, reason: INSTALL_REASONS.noAccepted })
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ error: INSTALL_REASONS.noAccepted })
    expect(callsTo(f.calls, 'solar.installations', 'insert')).toHaveLength(0)
    expect(callsTo(svc.calls, 'solar.installations', 'insert')).toHaveLength(0)
  })
  it('a second installation for the study is refused in words', async () => {
    setup({}, { writes: { 'solar.installations:insert': { error: { code: '23505', message: 'duplicate key' } } } })
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ error: INSTALL_REASONS.exists })
  })
  it('no study: says so', async () => {
    setup({ tables: { 'solar.studies': [] } })
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ error: INSTALL_REASONS.noStudy })
  })
})

describe('saveInstallationAction', () => {
  it('validates the date and the as-built record before writing', async () => {
    const f = setup()
    await expect(saveInstallationAction({ projectId: P, installationId: I, commissioningDate: '2026-02-30', asBuilt, notes: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ fieldErrors: { commissioningDate: 'Enter a real date (YYYY-MM-DD).' } })
    const bad = await saveInstallationAction({ projectId: P, installationId: I, commissioningDate: '2026-02-15', asBuilt: { ...asBuilt, dcKwp: -1 }, notes: null, expectedUpdatedAt: 'T1' })
    expect(bad).toHaveProperty('fieldErrors.asBuilt')
    expect(callsTo(f.calls, 'solar.installations', 'update')).toHaveLength(0)
  })
  it('updates on the loaded version; a changed row is stale', async () => {
    const f = setup({ writes: { 'solar.installations:update': { data: [{ updated_at: 'T2' }] } } })
    await expect(saveInstallationAction({ projectId: P, installationId: I, commissioningDate: '2026-02-15', asBuilt, notes: '  Handed over  ', expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'T2' })
    const u = callsTo(f.calls, 'solar.installations', 'update')[0]!
    expect(u.payload).toEqual({ commissioning_date: '2026-02-15', as_built: asBuilt, notes: 'Handed over' })
    expect(u.filters).toEqual([['eq', 'id', I], ['eq', 'project_id', P], ['eq', 'updated_at', 'T1']])
    setup({ writes: { 'solar.installations:update': { data: [] } } })
    await expect(saveInstallationAction({ projectId: P, installationId: I, commissioningDate: null, asBuilt, notes: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
})
