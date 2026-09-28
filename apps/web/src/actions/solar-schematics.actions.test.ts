import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn(), render: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/schematics/sheet-pdf', () => ({ renderSchematicSheetPdf: h.render }))

import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import {
  createSchematicAction, deleteSchematicsAction, exportSchematicSheetAction, replaceSchematicDrawingAction,
  saveSchematicAction, setIncludeInLoadAction, setSchematicWaivedAction, createMeterStubAction,
} from './solar-schematics.actions'

const P = 'p1'
const STALE = 'Someone else changed this — reload to see their version.'
const tables: FakeOptions['tables'] = {
  'solar.studies': [{ id: 's1', project_id: P, updated_at: 'T0' }],
  'projects.projects': [{ id: P, organisation_id: 'o1', name: 'Mall' }],
  'solar.schematics': [{ id: 'sc1', study_id: 's1', project_id: P, organisation_id: 'o1', name: 'Main', kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, updated_at: 'U0' }],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }],
  'solar.meters': [{ id: 'm1', label: 'Bulk', kind: 'bulk', node_id: null }, { id: 'm2', label: 'Pep', kind: 'tenant', node_id: 'n1' }],
  'solar.schematic_cards': [{ schematic_id: 'sc1', meter_id: 'm1' }, { schematic_id: 'sc1', meter_id: 'm2' }],
  'solar.schematic_lines': [{ schematic_id: 'sc1', project_id: P, from_meter_id: 'm1', to_meter_id: 'm2', line_type: 'supply' }],
  'solar.tenant_load_basis': [],
  'tenants.floor_plans': [{ id: 'fp1', project_id: P, name: 'SLD' }],
}
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('schematic actions', () => {
  it('every action re-checks Edit', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(deleteSchematicsAction({ projectId: P, ids: ['sc1'] })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })

  it('create: drawing + page, name required; a duplicate name has a sentence', async () => {
    const { calls } = setup({ writes: { 'solar.schematics:insert': { data: [{ id: 'sc9' }] } } })
    expect(await createSchematicAction({ projectId: P, name: '  ', description: null, source: { kind: 'blank' } })).toEqual({ error: 'Give the schematic a name.' })
    expect(await createSchematicAction({ projectId: P, name: 'MV', description: 'x', source: { kind: 'drawing', floorPlanId: 'fp1', pageIndex: 3 } })).toEqual({ ok: true, id: 'sc9' })
    expect(callsTo(calls, 'solar.schematics', 'insert')[0].payload).toEqual({ study_id: 's1', name: 'MV', description: 'x', kind: 'drawing', floor_plan_id: 'fp1', page_index: 3 })
    setup({ writes: { 'solar.schematics:insert': { data: null, error: { code: '23505', message: 'dup' } } } })
    expect(await createSchematicAction({ projectId: P, name: 'Main', description: null, source: { kind: 'blank' } })).toEqual({ error: 'A schematic with that name already exists.' })
  })

  it('replace drawing is stale-guarded', async () => {
    const { calls } = setup({ writes: { 'solar.schematics:update': { data: [] } } })
    expect(await replaceSchematicDrawingAction({ projectId: P, schematicId: 'sc1', floorPlanId: 'fp1', pageIndex: 2, expectedUpdatedAt: 'U0' })).toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.schematics', 'update')[0].filters).toEqual([['eq', 'id', 'sc1'], ['eq', 'project_id', P], ['eq', 'updated_at', 'U0']])
  })

  it('delete reports the count', async () => {
    setup({ writes: { 'solar.schematics:delete': { data: [{ id: 'sc1' }] } } })
    expect(await deleteSchematicsAction({ projectId: P, ids: ['sc1'] })).toEqual({ ok: true, deleted: 1 })
  })

  it('waiver writes the study on its version', async () => {
    const { calls } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T1' }] } } })
    expect(await setSchematicWaivedAction({ projectId: P, waived: true, expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.studies', 'update')[0].payload).toEqual({ schematic_waived: true })
  })

  it('save validates, calls the RPC, and maps stale / loop errors', async () => {
    const fake = setup({ rpc: { solar_save_schematic: { data: 'U1', error: null } } })
    const body = { projectId: P, schematicId: 'sc1', expectedUpdatedAt: 'U0', cards: [{ meterId: 'm1', x: 1, y: 2, w: 180, h: 64, colour: null }], lines: [] }
    expect(await saveSchematicAction(body)).toEqual({ ok: true, updatedAt: 'U1' })
    expect(fake.client.rpc).toHaveBeenCalledWith('solar_save_schematic', { p_schematic_id: 'sc1', p_expected_updated_at: 'U0', p_cards: body.cards, p_lines: [] })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'schematic_saved' }))
    expect(await saveSchematicAction({ ...body, cards: [{ meterId: 'm1', x: NaN, y: 2, w: 180, h: 64, colour: null }] })).toEqual({ error: 'A card has an invalid position or size.' })
    expect(await saveSchematicAction({ ...body, lines: [{ fromMeterId: 'm1', toMeterId: 'm2', waypoints: [1], lineType: 'supply' }] })).toEqual({ error: 'A connection has an invalid route.' })
    setup({ rpc: { solar_save_schematic: { data: null, error: { code: '40001', message: 'stale schematic' } } } })
    expect(await saveSchematicAction(body)).toEqual({ error: STALE })
    setup({ rpc: { solar_save_schematic: { data: null, error: { code: '23514', message: 'this connection would make a loop in the supply hierarchy' } } } })
    expect(await saveSchematicAction(body)).toEqual({ error: 'That connection would make a loop in the supply hierarchy.' })
  })

  it('include-in-load needs a tenant link; including writes a metered basis with this meter', async () => {
    const { calls } = setup()
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm1', include: true })).toEqual({ error: 'Link this meter to a tenant first (Load → Meters → Details).' })
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm2', include: true })).toEqual({ ok: true, nodeId: 'n1', included: { m2: true } })
    expect(callsTo(calls, 'solar.tenant_load_basis', 'insert')[0].payload).toEqual({ study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm2', weight: 1 }] })
  })

  it('include-in-load edits the tenant row on the version it read; a concurrent change or a racing insert is refused', async () => {
    const withRow = {
      ...tables,
      'solar.study_meters': [...tables['solar.study_meters']!, { study_id: 's1', meter_id: 'm3' }],
      'solar.meters': [...tables['solar.meters']!, { id: 'm3', label: 'Pep 2', kind: 'tenant', node_id: 'n1' }, { id: 'mX', label: 'Other study', kind: 'tenant', node_id: 'n1' }],
      'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm3', weight: 1 }], updated_at: 'B0' }],
    }
    const { calls } = setup({ tables: withRow, writes: { 'solar.tenant_load_basis:update': { data: [{ id: 'b1' }] } } })
    // Excluding one meter excludes the tenant: every meter of that tenant in this study reports the new state.
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm2', include: false })).toEqual({ ok: true, nodeId: 'n1', included: { m2: false, m3: false } })
    expect(callsTo(calls, 'solar.tenant_load_basis', 'update')[0].filters).toEqual([['eq', 'id', 'b1'], ['eq', 'updated_at', 'B0']])
    setup({ tables: withRow, writes: { 'solar.tenant_load_basis:update': { data: [{ id: 'b1' }] } } })
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm2', include: true })).toEqual({ ok: true, nodeId: 'n1', included: { m2: true, m3: true } })
    setup({ tables: withRow, writes: { 'solar.tenant_load_basis:update': { data: [] } } })
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm2', include: true })).toEqual({ error: STALE })
    setup({ writes: { 'solar.tenant_load_basis:insert': { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } } } })
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm2', include: true })).toEqual({ error: STALE })
  })

  it('meter stub: a library meter linked to this study', async () => {
    const { calls } = setup({ writes: { 'solar.meters:insert': { data: [{ id: 'm9', label: 'DB-4', kind: 'unknown' }] } } })
    expect(await createMeterStubAction({ projectId: P, label: 'DB-4', kind: 'unknown' })).toEqual({ ok: true, meter: { id: 'm9', label: 'DB-4', kind: 'unknown' } })
    expect(callsTo(calls, 'solar.meters', 'insert')[0].payload).toEqual({ organisation_id: 'o1', label: 'DB-4', kind: 'unknown', serials: [] })
    expect(callsTo(calls, 'solar.study_meters', 'upsert')[0].payload).toEqual({ study_id: 's1', meter_id: 'm9' })
  })

  it('export is refused when the schematic row moved on since the sheet was drawn', async () => {
    setup()
    const upload = vi.fn(async () => ({ error: null }))
    const svc = fakeSupabase({ tables: {} })
    h.createServiceClient.mockReturnValue(Object.assign(svc.client, { storage: { from: () => ({ upload, remove: vi.fn() }) } }))
    const r = await exportSchematicSheetAction({ projectId: P, schematicId: 'sc1', basedOn: 'U-old', jpegBase64: 'x'.repeat(200), crop: { w: 1000, h: 700 }, note: null })
    expect(r).toEqual({ error: 'This schematic has been saved since the sheet was drawn — save the schematic first (or reload to see the latest), then export.' })
    expect(upload).not.toHaveBeenCalled()
    expect(h.render).not.toHaveBeenCalled()
  })

  it('export: renders, stores the next version under kind solar_schematic_sheet, supersedes the prior', async () => {
    setup()
    const upload = vi.fn(async () => ({ error: null }))
    const svc = fakeSupabase({ tables: { 'projects.reports': [{ id: 'r1', project_id: P, kind: 'solar_schematic_sheet', source_id: 'sc1', status: 'issued', version: 2 }] }, writes: { 'projects.reports:insert': { data: [{ id: 'r2' }] } } })
    h.createServiceClient.mockReturnValue(Object.assign(svc.client, { storage: { from: () => ({ upload, remove: vi.fn() }) } }))
    const r = await exportSchematicSheetAction({ projectId: P, schematicId: 'sc1', basedOn: 'U0', jpegBase64: 'x'.repeat(200), crop: { w: 1000, h: 700 }, note: null })
    expect(r).toEqual({ ok: true, version: 3, reportId: 'r2' })
    expect(upload).toHaveBeenCalledWith('o1/p1/solar-schematic-sheets/sc1-v3.pdf', expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false })
    expect(callsTo(svc.calls, 'projects.reports', 'insert')[0].payload).toMatchObject({ kind: 'solar_schematic_sheet', source_table: 'solar.schematics', source_id: 'sc1', version: 3, status: 'issued' })
    expect(callsTo(svc.calls, 'projects.reports', 'update')[0].payload).toEqual({ status: 'superseded', superseded_by: 'r2' })
    // Owner change: no product event for this verb — the solar audit trail is the only record.
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schematic_sheet_exported', objectRef: { schematicId: 'sc1', version: 3 } })
  })
})
