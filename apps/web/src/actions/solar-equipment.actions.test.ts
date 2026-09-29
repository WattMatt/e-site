import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { EQUIPMENT_CSV_HEADER } from '@esite/shared/solar-cases'
import { OWNER_ADMIN } from '@esite/shared'

const h = vi.hoisted(() => ({ ctx: vi.fn(), role: vi.fn(), createClient: vi.fn(), emit: vi.fn(async () => {}), reval: vi.fn() }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.ctx }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.role }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.reval }))
import { saveSolarEquipmentAction, retireSolarEquipmentAction, importSolarEquipmentCsvAction } from './solar-equipment.actions'

const ORG = 'o1', U = 'u1'
const battery = { id: null, kind: 'battery' as const, make: 'A', model: 'B', specs: { usableKwh: 1, powerKw: 1, rtePct: 90 }, expectedUpdatedAt: null }
beforeEach(() => { vi.clearAllMocks(); h.ctx.mockResolvedValue({ organisationId: ORG, userId: U }); h.role.mockResolvedValue({ ok: true }) })

describe('equipment actions', () => {
  it('owner/admin of the ACTIVE org only (requireRole .ok) — nothing is written otherwise', async () => {
    const f = fakeSupabase({}); h.createClient.mockResolvedValue(f.client)
    h.role.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const NOT = { error: 'Only an organisation owner or admin can change the equipment catalogue.' }
    expect(await saveSolarEquipmentAction(battery)).toEqual(NOT)
    expect(await retireSolarEquipmentAction({ id: 'e1' })).toEqual(NOT)
    expect(await importSolarEquipmentCsvAction({ text: EQUIPMENT_CSV_HEADER.join(',') })).toEqual(NOT)
    expect(h.role).toHaveBeenCalledWith(f.client, ORG, OWNER_ADMIN)
    expect(f.calls).toHaveLength(0)
  })
  it('signed out → sentence', async () => {
    h.ctx.mockResolvedValue(null)
    expect(await saveSolarEquipmentAction(battery)).toEqual({ error: 'You are not signed in.' })
  })
  it('add validates specs by kind and writes into the active org', async () => {
    const f = fakeSupabase({ writes: { 'solar.equipment:insert': { data: [{ id: 'e1', updated_at: 'T1' }] } } }); h.createClient.mockResolvedValue(f.client)
    expect(await saveSolarEquipmentAction({ id: null, kind: 'module', make: 'A', model: 'B', specs: { pmaxW: -5, gammaPmaxPctPerC: -0.3 }, expectedUpdatedAt: null })).toMatchObject({ fieldErrors: { pmaxW: expect.any(String) } })
    expect(await saveSolarEquipmentAction({ id: null, kind: 'turbine' as never, make: 'A', model: 'B', specs: {}, expectedUpdatedAt: null })).toEqual({ fieldErrors: { kind: 'Choose module, inverter or battery' } })
    expect(await saveSolarEquipmentAction({ ...battery, make: '  ' })).toEqual({ fieldErrors: { make: 'Enter the make' } })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')).toHaveLength(0)
    expect(await saveSolarEquipmentAction({ id: null, kind: 'module', make: ' A ', model: 'B', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.3 }, expectedUpdatedAt: null })).toEqual({ ok: true, id: 'e1', updatedAt: 'T1' })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')[0]!.payload).toEqual({ organisation_id: ORG, kind: 'module', make: 'A', model: 'B', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.3 }, source: 'manual' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: null, organisationId: ORG, event: 'solar_equipment_saved' })
    expect(h.reval).toHaveBeenCalledWith('/settings/solar/equipment')
  })
  it('duplicate make/model → field error; edit is stale-guarded and scoped to the org; retire sets retired_at', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ writes: { 'solar.equipment:insert': { error: { code: '23505', message: 'dup' } } } }).client)
    expect(await saveSolarEquipmentAction(battery)).toEqual({ fieldErrors: { model: 'This make and model is already in the catalogue' } })
    const e = fakeSupabase({ writes: { 'solar.equipment:update': { data: [] } } }); h.createClient.mockResolvedValue(e.client)
    expect(await saveSolarEquipmentAction({ ...battery, id: 'e1', expectedUpdatedAt: 'T0' })).toEqual({ error: 'Someone else changed this — reload to see their version.' })
    expect(callsTo(e.calls, 'solar.equipment', 'update')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'id', 'e1'], ['eq', 'organisation_id', ORG], ['eq', 'kind', 'battery'], ['eq', 'updated_at', 'T0']]))
    const f = fakeSupabase({ writes: { 'solar.equipment:update': { data: [{ id: 'e1' }] } } }); h.createClient.mockResolvedValue(f.client)
    expect(await retireSolarEquipmentAction({ id: 'e1' })).toEqual({ ok: true })
    const u = callsTo(f.calls, 'solar.equipment', 'update')[0]!
    expect(Object.keys(u.payload as object)).toEqual(['retired_at'])
    expect(u.filters).toEqual(expect.arrayContaining([['eq', 'id', 'e1'], ['eq', 'organisation_id', ORG]]))
    h.createClient.mockResolvedValue(fakeSupabase({ writes: { 'solar.equipment:update': { data: [] } } }).client)
    expect(await retireSolarEquipmentAction({ id: 'platform-row' })).toEqual({ error: 'Nothing was retired — platform rows cannot be retired, and the row may have moved on.' })
  })
  it('CSV import: all-or-nothing on parse errors; inserts valid rows; reports duplicates as skipped', async () => {
    const f = fakeSupabase({}); h.createClient.mockResolvedValue(f.client)
    const H = EQUIPMENT_CSV_HEADER.join(',')
    const bad = await importSolarEquipmentCsvAction({ text: `${H}\nturbine,A,B` + ','.repeat(EQUIPMENT_CSV_HEADER.length - 3) })
    expect(bad).toEqual({ errors: [{ line: 2, message: 'kind must be module, inverter or battery' }] })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')).toHaveLength(0)
    const row = EQUIPMENT_CSV_HEADER.map((c) => ({ kind: 'battery', make: 'A', model: 'B', usableKwh: '10', powerKw: '5', rtePct: '90' } as Record<string, string>)[c] ?? '').join(',')
    const ok = await importSolarEquipmentCsvAction({ text: `${H}\n${row}` })
    expect(ok).toEqual({ ok: true, added: 1, skipped: 0 })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')[0]!.payload).toMatchObject({ organisation_id: ORG, source: 'csv' })
    h.createClient.mockResolvedValue(fakeSupabase({ writes: { 'solar.equipment:insert': { error: { code: '23505', message: 'dup' } } } }).client)
    expect(await importSolarEquipmentCsvAction({ text: `${H}\n${row}` })).toEqual({ ok: true, added: 0, skipped: 1 })
  })
  it('CSV import refuses a file over 512 KB before parsing', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({}).client)
    expect(await importSolarEquipmentCsvAction({ text: 'x'.repeat(512 * 1024 + 1) })).toEqual({ error: 'The file is larger than 512 KB.' })
  })
})
