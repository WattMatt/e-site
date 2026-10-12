// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeClient, queued, opsOf, type FakeResponse } from './__fixtures__/fake-client'
import { jsonUnsafePath } from './json-safe'

const { requireEffectiveRoleMock, loadTenantShopFactsMock, loadProjectDbOrderStatusMock } = vi.hoisted(() => ({
  requireEffectiveRoleMock: vi.fn(),
  loadTenantShopFactsMock: vi.fn(),
  loadProjectDbOrderStatusMock: vi.fn(),
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))
vi.mock('@/lib/tenant-schedule/shop-facts', () => ({ loadTenantShopFacts: (...a: unknown[]) => loadTenantShopFactsMock(...a) }))
vi.mock('@/lib/status-plans/project-db-orders', () => ({ loadProjectDbOrderStatus: (...a: unknown[]) => loadProjectDbOrderStatusMock(...a) }))

import { loadStatusPlanPage } from './load-plan-page'

const PLAN_ROW = {
  id: 'pl1', project_id: 'p1', organisation_id: 'org-1', floor_plan_id: 'fp1', page_index: 2, purpose: 'tenant_layout',
  name: 'Ground floor', source_file_path: 'org/p1/E-100 rev B.pdf', created_by: 'u', created_at: 't0', updated_at: 't1',
}
const SHAPE_ROW = {
  id: 's1', status_plan_id: 'pl1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260],
  node_id: 'n1', area_type: null, detected_tag: null, source: 'manual', created_by: 'u', created_at: 't0', updated_at: 't2',
}
const FACTS = {
  activeNodes: [{ id: 'n1', shopNumber: 'ZZ01', shopName: 'Lantern Books', glaM2: 80, breakerA: null, poleConfig: null, loadA: null }],
  decommissionedCount: 0,
  decommissionedNodeIds: [],
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([['n1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }]]),
  orderStatusByNodeScope: new Map([['n1:tdb', 'received'], ['n1:tlt', 'received']]),
  boByNode: new Map([['n1', { effectiveDate: '2026-05-01' }]]),
}

function tables(o: Record<string, FakeResponse[]> = {}) {
  return {
    'tenants.status_plans:select': [{ data: PLAN_ROW }],
    'tenants.floor_plans:select': [{ data: { id: 'fp1', name: 'E-100 Ground', file_path: 'org/p1/E-100 rev C.pdf', width_px: null, height_px: null, pixels_per_meter: 20 } }],
    'tenants.floor_plan_page_scales:select': [{ data: [{ page_index: 2, pixels_per_meter: 31.5 }] }],
    'tenants.status_plan_shapes:select': [{ data: [SHAPE_ROW] }],
    'projects.projects:select': [{ data: { id: 'p1', organisation_id: 'org-1', opening_date: '2026-09-01' } }],
    'structure.nodes:select': [{ data: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shop_number: 'ZZ01', shop_name: 'Lantern Books', name: null, shop_area_m2: '80.00', status: 'active' }] }],
    ...o,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  loadTenantShopFactsMock.mockResolvedValue(FACTS)
  loadProjectDbOrderStatusMock.mockResolvedValue({ m1: 'ordered' })
})

describe('loadStatusPlanPage', () => {
  it('assembles JSON-only props for a tenant layout', async () => {
    const { client, calls } = fakeClient(queued(tables()))
    const props = await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: 's1' })
    expect(props).not.toBeNull()
    expect(jsonUnsafePath(props)).toBeNull()
    expect(JSON.parse(JSON.stringify(props))).toEqual(props)

    expect(props!.plan).toEqual({ id: 'pl1', name: 'Ground floor', purpose: 'tenant_layout', pageIndex: 2, sourceFilePath: 'org/p1/E-100 rev B.pdf', updatedAt: 't1' })
    expect(props!.sheet).toMatchObject({
      floorPlanId: 'fp1', name: 'E-100 Ground', isPdf: true, currentFilePath: 'org/p1/E-100 rev C.pdf',
      signedUrl: 'https://signed.test/drawings/org/p1/E-100 rev C.pdf',
      pixels_per_meter: 20, page_scales: [{ pageIndex: 2, pixelsPerMeter: 31.5 }],
    })
    expect(props!.shapes.map((s) => s.id)).toEqual(['s1'])
    expect(props!.nodes).toEqual([{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 80, decommissioned: false }])
    expect(props!.shopLinks.n1).toEqual({ state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } })
    expect(props!.dbOrders).toEqual({})
    expect(props!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(props!.canEdit).toBe(true)
    expect(props!.initialShapeId).toBe('s1')

    expect(opsOf(calls, 'structure.nodes')).toContainEqual(['eq', ['kind', 'tenant_db']])
    expect(opsOf(calls, 'structure.nodes')).toContainEqual(['is', ['deleted_at', null]])
    expect(loadTenantShopFactsMock).toHaveBeenCalledWith(client, { projectId: 'p1', orgId: 'org-1', openingDate: '2026-09-01' })
    expect(loadProjectDbOrderStatusMock).not.toHaveBeenCalled()
  })

  it('one crossed outline does not crash the page: the good shape is normal, the bad one flagged', async () => {
    const crossed = { ...SHAPE_ROW, id: 's2', shape: 'polygon', points: [0, 0, 10, 10, 10, 0, 0, 10], node_id: null }
    const { client } = fakeClient(queued(tables({ 'tenants.status_plan_shapes:select': [{ data: [SHAPE_ROW, crossed] }] })))
    const props = await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null })
    expect(props!.shapes.map((s) => s.id)).toEqual(['s1', 's2'])
    expect('invalidReason' in props!.shapes[0]!).toBe(false)
    expect(props!.shapes[1]!.invalidReason).toBe('Outline needs redrawing')
    expect(jsonUnsafePath(props)).toBeNull()
  })

  it('today is the Johannesburg date, not the UTC one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T23:30:00Z'))
    try {
      const { client } = fakeClient(queued(tables()))
      expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null }))!.today).toBe('2026-10-10')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads a schematic with every live node and DB orders, not tenant facts', async () => {
    const { client, calls } = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: { ...PLAN_ROW, purpose: 'distribution_schematic' } }] })))
    const props = await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null })
    expect(props!.dbOrders).toEqual({ m1: 'ordered' })
    expect(props!.shopLinks).toEqual({})
    expect(opsOf(calls, 'structure.nodes')).not.toContainEqual(['eq', ['kind', 'tenant_db']])
    expect(loadTenantShopFactsMock).not.toHaveBeenCalled()
  })

  it('a read-only role gets the same props with canEdit false', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const { client } = fakeClient(queued(tables()))
    expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null }))!.canEdit).toBe(false)
  })

  it('a ?shape= that is not on this plan selects nothing', async () => {
    const { client } = fakeClient(queued(tables()))
    expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: 'elsewhere' }))!.initialShapeId).toBeNull()
  })

  it('null (→ 404) when the plan is invisible or belongs to another project', async () => {
    const a = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: null }] })))
    expect(await loadStatusPlanPage(a.client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null })).toBeNull()
    const b = fakeClient(queued(tables()))
    expect(await loadStatusPlanPage(b.client, { projectId: 'other', planId: 'pl1', requestedShapeId: null })).toBeNull()
  })

  it('a drawing the canvas cannot render gets no signed URL', async () => {
    const { client } = fakeClient(queued(tables({
      'tenants.floor_plans:select': [{ data: { id: 'fp1', name: 'E-100', file_path: 'x/E-100.dwg', width_px: null, height_px: null, pixels_per_meter: null } }],
    })))
    expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null }))!.sheet.signedUrl).toBeNull()
  })
})
