import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getOrgContext: vi.fn(),
  requireEffectiveRole: vi.fn(),
  updateItemRate: vi.fn(),
  loadProjectBoq: vi.fn(),
  loadItems: vi.fn(),
  loadActiveObservations: vi.fn(),
  loadIndexSeries: vi.fn(),
  logRateAccess: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.getOrgContext }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/rate-library/project-boq', () => ({ loadProjectBoq: h.loadProjectBoq }))
vi.mock('@/lib/rate-library/data', async orig => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  loadItems: h.loadItems, loadActiveObservations: h.loadActiveObservations, loadIndexSeries: h.loadIndexSeries, logRateAccess: h.logRateAccess,
}))
vi.mock('@esite/shared', async orig => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  boqService: { updateItemRate: h.updateItemRate },
}))

import { addProjectBoqToLibraryAction, aiSuggestGroupAction, applyPriceFromLibraryAction, confirmGroupAction } from './rate-catalogue.actions'
import { cpiFromTable } from '@esite/shared'

/** A fake Supabase client: each call records (table, ops) and resolves via `handler`. */
type Op = { table: string; ops: [string, unknown[]][] }
function fakeClient(handler: (op: Op) => { data?: unknown; error?: unknown }) {
  const calls: Op[] = []
  const builder = (table: string) => {
    const op: Op = { table, ops: [] }
    calls.push(op)
    const resolve = () => Promise.resolve({ data: null, error: null, ...handler(op) })
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'update', 'insert', 'upsert', 'range', 'limit']) {
      b[m] = (...a: unknown[]) => { op.ops.push([m, a]); return b }
    }
    b.single = () => resolve()
    b.maybeSingle = () => resolve()
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => resolve().then(ok, ko)
    return b
  }
  const rpc = (name: string, args: unknown) => {
    const op: Op = { table: `rpc:${name}`, ops: [['args', [args]]] }
    calls.push(op)
    return Promise.resolve({ data: null, error: null, ...handler(op) })
  }
  return { from: builder, schema: () => ({ from: builder }), rpc, calls }
}
const has = (op: Op, m: string) => op.ops.some(([n]) => n === m)

const ORG = 'org-1'
beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ANTHROPIC_API_KEY
  h.getOrgContext.mockResolvedValue({ userId: 'u1', organisationId: ORG, role: 'project_manager' })
  h.requireEffectiveRole.mockResolvedValue({ ok: true, role: 'project_manager' })
})

describe('gate', () => {
  it.each(['contractor', 'client_viewer', 'supplier', 'inspector'])('%s is refused before any read', async role => {
    h.getOrgContext.mockResolvedValue({ userId: 'u1', organisationId: ORG, role })
    const db = fakeClient(() => ({}))
    h.createClient.mockResolvedValue(db)
    const r = await confirmGroupAction('g', 'i1')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('owners, admins and project managers') })
    expect(db.calls).toEqual([])
  })
})

describe('confirmGroupAction', () => {
  const lines = [
    { id: 'l1', source_id: 's1', unit: 'No', supply_rate: 10, install_rate: 5, rate: null, match_status: 'unmatched' },
    { id: 'l2', source_id: 's1', unit: 'No', supply_rate: 10, install_rate: 5, rate: null, match_status: 'unmatched' },
    { id: 'l3', source_id: 's1', unit: 'No', supply_rate: 12, install_rate: 5, rate: null, match_status: 'unmatched' },
  ]
  const source = { id: 's1', contractor_name: 'C', project_id: null, project_label: 'P', province: 'Gauteng', priced_on: '2026-06-25' }

  it('refuses an item priced in a different unit and writes nothing', async () => {
    const db = fakeClient(op => op.table === 'rate_items' ? { data: { id: 'i1', unit: 'm', is_active: true } } : { data: lines })
    h.createClient.mockResolvedValue(db)
    const r = await confirmGroupAction('g', 'i1')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('priced per no; the item is per m')
    expect(db.calls.some(c => has(c, 'update') || has(c, 'insert'))).toBe(false)
  })

  it('confirms in ONE call to rate_library_confirm_lines with exactly the queued lines', async () => {
    const db = fakeClient(op => {
      if (op.table === 'rate_items') return { data: { id: 'i1', unit: 'no', is_active: true } }
      if (op.table === 'rpc:rate_library_confirm_lines') return { data: { lines: 3, observations: 2 } }
      return { data: lines }
    })
    h.createClient.mockResolvedValue(db)
    const r = await confirmGroupAction('g', 'i1')
    expect(r).toEqual({ ok: true, data: { lines: 3, observations: 2 } })
    const call = db.calls.find(c => c.table === 'rpc:rate_library_confirm_lines')!
    expect(call.ops[0][1][0]).toEqual({ p_org: ORG, p_line_ids: ['l1', 'l2', 'l3'], p_item: 'i1', p_method: 'manual' })
    // No direct writes: the function is the only writer.
    expect(db.calls.some(c => has(c, 'update') || has(c, 'insert'))).toBe(false)
  })

  it('reports a concurrent review (40001) and writes nothing else', async () => {
    const db = fakeClient(op => {
      if (op.table === 'rate_items') return { data: { id: 'i1', unit: 'no', is_active: true } }
      if (op.table === 'rpc:rate_library_confirm_lines') return { error: { code: '40001', message: '1 of 3 lines are no longer in the queue' } }
      return { data: lines }
    })
    h.createClient.mockResolvedValue(db)
    const r = await confirmGroupAction('g', 'i1')
    expect(!r.ok && r.error).toContain('Another reviewer')
    expect(db.calls.some(c => has(c, 'update') || has(c, 'insert'))).toBe(false)
  })
})

describe('aiSuggestGroupAction', () => {
  it('is off without a key and touches nothing', async () => {
    const db = fakeClient(() => ({}))
    h.createClient.mockResolvedValue(db)
    const r = await aiSuggestGroupAction('g')
    expect(!r.ok && r.error).toContain('no Anthropic API key')
    expect(db.calls).toEqual([])
  })
})

describe('addProjectBoqToLibraryAction', () => {
  it('refuses an import that holds library rates (no loop back into the library)', async () => {
    h.createServiceClient.mockReturnValue(fakeClient(() => ({ data: { id: 'p1', name: 'P', province: 'Gauteng', organisation_id: ORG } })))
    const db = fakeClient(() => ({}))
    h.createClient.mockResolvedValue(db)
    h.loadProjectBoq.mockResolvedValue({ importId: 'imp', sourceFilename: null, importedAt: '2026-06-01T00:00:00Z', totalExVat: null, libraryPricedAt: '2026-10-05T10:00:00Z', lines: [] })
    const r = await addProjectBoqToLibraryAction('p1', { contractorName: 'AEEC' })
    expect(!r.ok && r.error).toContain('cannot go back into the library')
    expect(db.calls.some(c => c.table.startsWith('rpc:'))).toBe(false)
  })
})

describe('applyPriceFromLibraryAction', () => {
  const projectId = 'p1'
  const boq = {
    importId: 'imp', sourceFilename: null, importedAt: '2026-06-01T00:00:00Z', totalExVat: null,
    lines: [
      { boqItemId: 'b-conduit', origin: null, rateModel: 'supply_install', sectionPath: ['CONDUIT'], description: '20mm Ø', unit: 'm', quantityMode: 'measured', supplyRate: null, installRate: null, rate: null, sheet: null, rowRef: null, code: null, quantity: 1, amount: null },
      { boqItemId: 'b-light', origin: null, rateModel: 'supply_install', sectionPath: ['LIGHT FITTINGS'], description: 'Type A', unit: 'No', quantityMode: 'measured', supplyRate: null, installRate: null, rate: null, sheet: null, rowRef: null, code: null, quantity: 1, amount: null },
    ],
  }
  beforeEach(() => {
    const service = fakeClient(op => (op.table === 'projects' ? { data: { id: projectId, name: 'P', province: 'Gauteng', organisation_id: ORG } } : {}))
    h.createServiceClient.mockReturnValue(service)
    h.createClient.mockResolvedValue(fakeClient(() => ({})))
    h.loadProjectBoq.mockResolvedValue(boq)
    h.loadItems.mockResolvedValue([{ id: 'i1', code: 'CONDUIT-20-PVC-M', signature: 'conduit|m|dia=20|material=pvc', category: 'conduit', description: 'x', unit: 'm', attributes: {}, origin: 'rule', is_active: true }])
    h.loadActiveObservations.mockResolvedValue([
      { rate_item_id: 'i1', supply_rate: 4, install_rate: 2, rate: 6, priced_on: '2026-01-10', project_id: 'other' },
      { rate_item_id: 'i1', supply_rate: 6, install_rate: 4, rate: 10, priced_on: '2026-01-10', project_id: 'other' },
      // the project's own BOQ must never price itself
      { rate_item_id: 'i1', supply_rate: 100, install_rate: 100, rate: 200, priced_on: '2026-01-10', project_id: projectId },
    ])
    h.loadIndexSeries.mockResolvedValue(cpiFromTable({ 2026: [100, 100] }))
  })

  const shown = (boqItemId: string, supplyRate: number | null, installRate: number | null) => ({ boqItemId, proposed: { supplyRate, installRate, rate: null } })

  it('writes the rates that were shown, excluding the project\'s own observations, and stamps the import', async () => {
    const service = h.createServiceClient()
    const r = await applyPriceFromLibraryAction(projectId, 'median', [shown('b-conduit', 5, 3)])
    expect(r).toEqual({ ok: true, data: { updated: 1 } })
    expect(h.updateItemRate).toHaveBeenCalledWith(expect.anything(), 'b-conduit', { supplyRate: 5, installRate: 3 })
    const stamp = service.calls.find((c: Op) => c.table === 'boq_imports' && has(c, 'update'))
    expect(stamp?.ops.find(([m]: [string]) => m === 'update')![1][0]).toHaveProperty('library_priced_at')
  })

  it('refuses when the library changed since the preview, writing nothing', async () => {
    const service = h.createServiceClient()
    const r = await applyPriceFromLibraryAction(projectId, 'median', [shown('b-conduit', 6, 3)])
    expect(!r.ok && r.error).toContain('changed since the preview')
    expect(h.updateItemRate).not.toHaveBeenCalled()
    expect(service.calls.some((c: Op) => c.table === 'boq_imports' && has(c, 'update'))).toBe(false)
  })

  it('refuses a line the library cannot price, writing nothing', async () => {
    const r = await applyPriceFromLibraryAction(projectId, 'median', [shown('b-conduit', 5, 3), shown('b-light', 1, 1)])
    expect(r.ok).toBe(false)
    expect(h.updateItemRate).not.toHaveBeenCalled()
  })

  it('refuses a project of another organisation', async () => {
    h.createServiceClient.mockReturnValue(fakeClient(() => ({ data: { id: projectId, name: 'P', province: null, organisation_id: 'org-2' } })))
    const r = await applyPriceFromLibraryAction(projectId, 'median', [shown('b-conduit', 5, 3)])
    expect(r).toEqual({ ok: false, error: 'Project not found in your organisation' })
    expect(h.updateItemRate).not.toHaveBeenCalled()
  })
})
