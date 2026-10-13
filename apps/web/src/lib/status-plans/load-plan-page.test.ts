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

import { loadTenantPlanPage, pickSheet } from './load-plan-page'

const PLAN_ROW = {
  id: 'pl1', project_id: 'p1', organisation_id: 'org-1', purpose: 'tenant_layout', name: 'Floor plan',
  created_by: 'u', created_at: 't0', updated_at: 't1',
}
const sheetRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, status_plan_id: 'pl1', organisation_id: 'org-1', sort_order: 0, label: `Sheet ${id}`, file_path: `org-1/p1/pl1/${id}/1.pdf`,
  page_index: 1, file_name: 'E-100.pdf', mime: 'application/pdf', revision: 1, replaced_at: null, replaced_from_path: null,
  pixels_per_meter: '20', calibration_points: [0, 0, 100, 0], calibration_metres: '5', created_by: 'u', created_at: 't0', updated_at: 'u0',
  ...over,
})
const SHAPE_ROW = {
  id: 's1', status_plan_id: 'pl1', sheet_id: 'sh1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260],
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
    'projects.projects:select': [{ data: { id: 'p1', organisation_id: 'org-1', opening_date: '2026-09-01' } }],
    'tenants.status_plans:select': [{ data: PLAN_ROW }],
    'tenants.status_plan_sheets:select': [{ data: [sheetRow('sh1'), sheetRow('sh2', { sort_order: 1, page_index: 2, pixels_per_meter: null, calibration_points: null, calibration_metres: null })] }],
    'tenants.status_plan_shapes:select': [{ data: [SHAPE_ROW, { ...SHAPE_ROW, id: 's2', sheet_id: 'sh2', node_id: null }] }],
    'structure.nodes:select': [{ data: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shop_number: 'ZZ01', shop_name: 'Lantern Books', name: null, shop_area_m2: '80.00', status: 'active' }] }],
    ...o,
  }
}
const args = (o: Partial<Parameters<typeof loadTenantPlanPage>[1]> = {}) =>
  ({ projectId: 'p1', purpose: 'tenant_layout' as const, requestedSheetId: null, requestedShapeId: null, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  loadTenantShopFactsMock.mockResolvedValue(FACTS)
  loadProjectDbOrderStatusMock.mockResolvedValue({ m1: 'ordered' })
})

describe('loadTenantPlanPage', () => {
  it('assembles JSON-only props: every sheet, the first sheet open, every shape', async () => {
    const { client, calls } = fakeClient(queued(tables()))
    const data = await loadTenantPlanPage(client, args())
    expect(data?.kind).toBe('plan')
    if (data?.kind !== 'plan') return
    const props = data.props
    expect(jsonUnsafePath(props)).toBeNull()
    expect(JSON.parse(JSON.stringify(props))).toEqual(props)
    expect(props.plan).toEqual({ id: 'pl1', name: 'Floor plan', purpose: 'tenant_layout', updatedAt: 't1' })
    expect(props.sheets.map((s) => [s.id, s.pixelsPerMeter])).toEqual([['sh1', 20], ['sh2', null]])
    expect(props.sheet).toMatchObject({ id: 'sh1', pageIndex: 1, isPdf: true, signedUrl: 'https://signed.test/tenant-plan-files/org-1/p1/pl1/sh1/1.pdf' })
    expect(props.shapes.map((s) => [s.id, s.sheetId])).toEqual([['s1', 'sh1'], ['s2', 'sh2']])
    expect(props.shopLinks.n1).toEqual({ state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } })
    expect(props.canEdit).toBe(true)
    expect(opsOf(calls, 'tenants.status_plans')).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['eq', ['purpose', 'tenant_layout']]]))
    expect(opsOf(calls, 'tenants.status_plan_sheets')).toContainEqual(['order', ['sort_order']])
    expect(opsOf(calls, 'structure.nodes')).toContainEqual(['eq', ['kind', 'tenant_db']])
  })

  it('?sheet= opens that sheet; ?shape= alone opens the shape\'s sheet and selects it', async () => {
    const a = fakeClient(queued(tables()))
    const onSecond = await loadTenantPlanPage(a.client, args({ requestedSheetId: 'sh2' }))
    expect(onSecond?.kind === 'plan' && onSecond.props.sheet.id).toBe('sh2')
    const b = fakeClient(queued(tables()))
    const viaShape = await loadTenantPlanPage(b.client, args({ requestedShapeId: 's2' }))
    expect(viaShape?.kind === 'plan' && [viaShape.props.sheet.id, viaShape.props.initialShapeId]).toEqual(['sh2', 's2'])
  })

  it('a ?shape= on another sheet than ?sheet= selects nothing', async () => {
    const { client } = fakeClient(queued(tables()))
    const data = await loadTenantPlanPage(client, args({ requestedSheetId: 'sh1', requestedShapeId: 's2' }))
    expect(data?.kind === 'plan' && data.props.initialShapeId).toBeNull()
  })

  it('no plan yet, or a plan with no sheets, is the empty state with the caller\'s edit right', async () => {
    const a = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: null }] })))
    expect(await loadTenantPlanPage(a.client, args())).toEqual({ kind: 'empty', empty: { projectId: 'p1', purpose: 'tenant_layout', canEdit: true } })
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'no' })
    const b = fakeClient(queued(tables({ 'tenants.status_plan_sheets:select': [{ data: [] }] })))
    expect(await loadTenantPlanPage(b.client, args())).toEqual({ kind: 'empty', empty: { projectId: 'p1', purpose: 'tenant_layout', canEdit: false } })
  })

  it('a line diagram reads every live node and DB orders, not tenant facts', async () => {
    const { client, calls } = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: { ...PLAN_ROW, purpose: 'distribution_schematic' } }] })))
    const data = await loadTenantPlanPage(client, args({ purpose: 'distribution_schematic' }))
    expect(data?.kind === 'plan' && data.props.dbOrders).toEqual({ m1: 'ordered' })
    expect(opsOf(calls, 'structure.nodes')).not.toContainEqual(['eq', ['kind', 'tenant_db']])
    expect(loadTenantShopFactsMock).not.toHaveBeenCalled()
  })

  it('null (→ 404) when the project is invisible', async () => {
    const { client } = fakeClient(queued(tables({ 'projects.projects:select': [{ data: null }] })))
    expect(await loadTenantPlanPage(client, args())).toBeNull()
  })

  it('today is the Johannesburg date, not the UTC one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T23:30:00Z'))
    try {
      const { client } = fakeClient(queued(tables()))
      const data = await loadTenantPlanPage(client, args())
      expect(data?.kind === 'plan' && data.props.today).toBe('2026-10-10')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('pickSheet', () => {
  const sheets = [{ id: 'a' }, { id: 'b' }] as never[]
  it('asked-for sheet, else the shape\'s sheet, else the first', () => {
    expect((pickSheet(sheets, [], 'b', null) as { id: string }).id).toBe('b')
    expect((pickSheet(sheets, [{ id: 's', sheetId: 'b' }] as never[], 'zz', 's') as { id: string }).id).toBe('b')
    expect((pickSheet(sheets, [], null, null) as { id: string }).id).toBe('a')
  })
})
