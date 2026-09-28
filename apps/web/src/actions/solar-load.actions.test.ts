import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EMPTY_BILLS_FORM } from '@esite/shared'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import {
  applyAutoMatchAction, acknowledgeCheckAction, ensureSolarStudyAction, excludeVacantAction, removeStudyMeterAction,
  saveLoadBasisAction, saveLoadSettingsAction, saveTenantBasisAction, updateStudyMeterAction,
} from './solar-load.actions'

const P = 'p1'
const STALE = 'Someone else changed this — reload to see their version.'
const base: FakeOptions['tables'] = {
  'solar.studies': [{ id: 's1', project_id: P, updated_at: 'T0' }],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }],
  'solar.meters': [{ id: 'm1', kind: 'tenant', updated_at: 'M0' }, { id: 'm2', kind: 'bulk', updated_at: 'M0' }],
  'structure.nodes': [{ id: 'n1', project_id: P, kind: 'tenant_db' }, { id: 'n9', project_id: 'other', kind: 'tenant_db' }],
  'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }, { meter_id: 'm2', weight: 1 }], updated_at: 'B0' }],
}
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables: base, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('solar-load actions', () => {
  it('every action re-checks Edit', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(ensureSolarStudyAction(P)).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })

  it('ensureSolarStudyAction returns the existing study without writing', async () => {
    const { calls } = setup()
    expect(await ensureSolarStudyAction(P)).toEqual({ ok: true, studyId: 's1', updatedAt: 'T0' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('saveLoadBasisAction writes the basis on the loaded version; a stale write is refused', async () => {
    const { calls } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T1' }] } } })
    expect(await saveLoadBasisAction({ projectId: P, basis: 'S1', expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.studies', 'update')[0]).toMatchObject({ payload: { load_basis: 'S1' }, filters: [['eq', 'project_id', P], ['eq', 'updated_at', 'T0']] })
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    expect(await saveLoadBasisAction({ projectId: P, basis: 'S1', expectedUpdatedAt: 'T0' })).toEqual({ error: STALE })
    expect(await saveLoadBasisAction({ projectId: P, basis: 'S9' as never, expectedUpdatedAt: 'T0' })).toEqual({ error: 'Choose a load basis.' })
  })

  it('saveLoadSettingsAction returns field errors without writing', async () => {
    const { calls } = setup()
    const r = await saveLoadSettingsAction({ projectId: P, form: { loadBasis: 'S2', referenceYear: '1999', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '' }, bills: EMPTY_BILLS_FORM, expectedUpdatedAt: 'T0' })
    expect(r).toEqual({ fieldErrors: { referenceYear: 'Reference year must be between 2000 and 2100' } })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('saveLoadSettingsAction never writes the basis or the allowance, and requires bills from the SAVED basis', async () => {
    const tables = { ...base, 'solar.studies': [{ id: 's1', project_id: P, updated_at: 'T0', load_basis: 'S4' }] }
    const form = { loadBasis: 'S2' as const, referenceYear: '', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '99' }
    const { calls } = setup({ tables })
    const r = await saveLoadSettingsAction({ projectId: P, form, bills: EMPTY_BILLS_FORM, expectedUpdatedAt: 'T0' })
    expect(r).toMatchObject({ fieldErrors: { bills: expect.stringMatching(/January/) } })
    expect(callsTo(calls, 'solar.studies', 'update')).toHaveLength(0)
    const ok = setup({ tables: { ...tables, 'solar.studies': [{ id: 's1', project_id: P, updated_at: 'T0', load_basis: 'S2' }] }, writes: { 'solar.studies:update': { data: [{ updated_at: 'T1' }] } } })
    expect(await saveLoadSettingsAction({ projectId: P, form: { ...form, loadBasis: 'S4' }, bills: EMPTY_BILLS_FORM, expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T1' })
    const payload = callsTo(ok.calls, 'solar.studies', 'update')[0]!.payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('load_basis')
    expect(payload).not.toHaveProperty('common_area_pct')
  })

  it('updateStudyMeterAction refuses a meter outside the study and a node of another project; confirms supply point only for bulk', async () => {
    setup()
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'mX', patch: { label: 'x' }, expectedUpdatedAt: 'M0' })).toEqual({ error: 'That meter is not in this study.' })
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'm1', patch: { nodeId: 'n9' }, expectedUpdatedAt: 'M0' })).toEqual({ error: 'That tenant is not in this project.' })
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'm1', patch: { supplyPointConfirmed: true }, expectedUpdatedAt: 'M0' })).toEqual({ error: 'Only a bulk meter can be the point of supply.' })
    const { calls } = setup({ writes: { 'solar.meters:update': { data: [{ updated_at: 'M1' }] } } })
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'm2', patch: { supplyPointConfirmed: true, areaM2: 50 }, expectedUpdatedAt: 'M0' })).toEqual({ ok: true, updatedAt: 'M1' })
    expect(callsTo(calls, 'solar.meters', 'update')[0].payload).toEqual({ supply_point_confirmed: true, area_m2: 50, area_source: 'manual' })
  })

  it('removeStudyMeterAction unlinks, strips the meter from tenant assignments, and drops its schematic cards', async () => {
    const { calls } = setup({ tables: { ...base, 'solar.schematics': [{ id: 'sc1', study_id: 's1' }] } })
    expect(await removeStudyMeterAction({ projectId: P, meterId: 'm1', alsoDeleteFromLibrary: false })).toEqual({ ok: true, deletedFromLibrary: false })
    expect(callsTo(calls, 'solar.study_meters', 'delete')[0].filters).toEqual([['eq', 'study_id', 's1'], ['eq', 'meter_id', 'm1']])
    expect(callsTo(calls, 'solar.tenant_load_basis', 'update')[0].payload).toEqual({ meters: [{ meter_id: 'm2', weight: 1 }], source: 'metered' })
    expect(callsTo(calls, 'solar.schematic_cards', 'delete')[0].filters).toEqual([['in', 'schematic_id', ['sc1']], ['eq', 'meter_id', 'm1']])
  })

  it('removeStudyMeterAction: a removal that could not also delete from the library is a SUCCESS with a note', async () => {
    const shared = { ...base, 'solar.study_meters': [...base['solar.study_meters']!, { study_id: 's2', meter_id: 'm1' }] }
    const { calls } = setup({ tables: shared })
    const r = await removeStudyMeterAction({ projectId: P, meterId: 'm1', alsoDeleteFromLibrary: true })
    expect(r).toEqual({ ok: true, deletedFromLibrary: false, note: 'Removed from this study; the meter is still used by another study, so it stays in the library.' })
    expect(callsTo(calls, 'solar.study_meters', 'delete')).toHaveLength(1)
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'meter_removed_from_study' }))
    setup({ writes: { 'solar.meters:delete': { data: [] } } })
    expect(await removeStudyMeterAction({ projectId: P, meterId: 'm1', alsoDeleteFromLibrary: true }))
      .toEqual({ ok: true, deletedFromLibrary: false, note: 'Removed from this study; only an org owner or admin can delete it from the library.' })
  })

  it('saveTenantBasisAction validates source, meters and weights', async () => {
    setup()
    expect(await saveTenantBasisAction({ projectId: P, nodeId: 'n1', source: 'metered', meters: [], archetype: null, densityOverride: null, expectedUpdatedAt: 'B0' }))
      .toEqual({ error: 'A metered tenant needs at least one meter.' })
    expect(await saveTenantBasisAction({ projectId: P, nodeId: 'n1', source: 'metered', meters: [{ meterId: 'm1', weight: 0 }], archetype: null, densityOverride: null, expectedUpdatedAt: 'B0' }))
      .toEqual({ error: 'Every meter weight must be greater than 0.' })
    expect(await saveTenantBasisAction({ projectId: P, nodeId: 'n1', source: 'metered', meters: [{ meterId: 'mX', weight: 1 }], archetype: null, densityOverride: null, expectedUpdatedAt: 'B0' }))
      .toEqual({ error: 'That meter is not in this study.' })
  })

  it('applyAutoMatchAction appends meters, links meters to their tenant on the meter version read, and counts', async () => {
    const { calls } = setup({ writes: { 'solar.tenant_load_basis:update': { data: [{ id: 'b1' }] }, 'solar.meters:update': { data: [{ id: 'm2' }] } } })
    expect(await applyAutoMatchAction({ projectId: P, pairs: [{ nodeId: 'n1', meterId: 'm2' }] })).toEqual({ ok: true, applied: 1, staleMeters: 0 })
    expect(callsTo(calls, 'solar.meters', 'update')[0]).toMatchObject({ payload: { node_id: 'n1' }, filters: [['eq', 'id', 'm2'], ['eq', 'updated_at', 'M0']] })
    expect(callsTo(calls, 'solar.tenant_load_basis', 'update')[0].filters).toContainEqual(['eq', 'updated_at', 'B0'])
  })

  it('applyAutoMatchAction counts a meter link only when its row changed', async () => {
    setup({ writes: { 'solar.tenant_load_basis:update': { data: [{ id: 'b1' }] }, 'solar.meters:update': { data: [] } } })
    expect(await applyAutoMatchAction({ projectId: P, pairs: [{ nodeId: 'n1', meterId: 'm2' }] })).toEqual({ ok: true, applied: 0, staleMeters: 1 })
  })

  it('excludeVacantAction pins each tenant row, reports stale ones, keeps their meters, and counts only what landed', async () => {
    const tables = {
      ...base,
      'structure.nodes': [
        { id: 'n1', project_id: P, kind: 'tenant_db', shop_number: '12', name: 'VACANT' },
        { id: 'n2', project_id: P, kind: 'tenant_db', shop_number: '13', name: 'Vacant unit' },
        { id: 'n3', project_id: P, kind: 'tenant_db', shop_number: '14', name: 'Vacant' },
        { id: 'n4', project_id: P, kind: 'tenant_db', shop_number: '15', name: 'Pep' },
      ],
      'solar.tenant_load_basis': [
        { id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }], updated_at: 'B0' },
        { id: 'b2', study_id: 's1', node_id: 'n2', source: 'synthesised', meters: [], updated_at: 'B9' },
      ],
    }
    const { calls } = setup({
      tables,
      writes: { 'solar.tenant_load_basis:update': (c) => ({ data: c.filters.some(([, col, v]) => col === 'updated_at' && v === 'B9') ? [] : [{ id: 'x' }] }) },
    })
    const r = await excludeVacantAction({ projectId: P, nodeIds: ['n1', 'n2', 'n3', 'n4'] })
    // n1 lands (pinned on B0), n2 changed underneath → reported, n3 inserted, n4 is not vacant → never touched.
    expect(r).toEqual({ ok: true, count: 2, stale: ['13 Vacant unit'], notVacant: 1 })
    const ups = callsTo(calls, 'solar.tenant_load_basis', 'update')
    expect(ups[0]).toMatchObject({ payload: { source: 'excluded' }, filters: [['eq', 'study_id', 's1'], ['eq', 'node_id', 'n1'], ['eq', 'updated_at', 'B0']] })
    expect(ups.map((u) => u.filters.find((f) => f[1] === 'node_id')?.[2])).toEqual(['n1', 'n2'])
    expect(callsTo(calls, 'solar.tenant_load_basis', 'insert').map((c) => (c.payload as { node_id: string }).node_id)).toEqual(['n3'])
  })

  it('read-modify-write of a tenant assignment refuses a concurrent edit (auto-match and remove)', async () => {
    const { calls } = setup({ writes: { 'solar.tenant_load_basis:update': { data: [] } } })
    expect(await applyAutoMatchAction({ projectId: P, pairs: [{ nodeId: 'n1', meterId: 'm2' }] })).toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.meters', 'update')).toHaveLength(0)
    const r = setup({ writes: { 'solar.tenant_load_basis:update': { data: [] } } })
    expect(await removeStudyMeterAction({ projectId: P, meterId: 'm1', alsoDeleteFromLibrary: false })).toEqual({ error: STALE })
    expect(callsTo(r.calls, 'solar.study_meters', 'delete')).toHaveLength(0)
  })

  it('excludeVacantAction: a racing first insert is reported stale, not an error', async () => {
    setup({
      tables: { ...base, 'structure.nodes': [{ id: 'n5', project_id: P, kind: 'tenant_db', shop_number: null, name: 'VACANT' }] },
      writes: { 'solar.tenant_load_basis:insert': { data: null, error: { code: '23505', message: 'duplicate' } } },
    })
    expect(await excludeVacantAction({ projectId: P, nodeIds: ['n5'] })).toEqual({ ok: true, count: 0, stale: ['VACANT'], notVacant: 0 })
  })

  it('acknowledgeCheckAction records the key and note', async () => {
    const { calls } = setup()
    expect(await acknowledgeCheckAction({ projectId: P, checkKey: 'recon_bulk:b:3', note: 'common area' })).toEqual({ ok: true })
    expect(callsTo(calls, 'solar.load_check_acks', 'insert')[0].payload).toEqual({ study_id: 's1', check_key: 'recon_bulk:b:3', note: 'common area' })
  })
})
