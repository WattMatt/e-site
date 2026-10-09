// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COLOURS, areaShapeStyle, dbBlockStyle, tenantShapeStyle } from '@esite/shared/status-plans'
import { fakeSupabase } from '@/test/fake-supabase'

const factsMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-schedule/shop-facts', () => ({ loadTenantShopFacts: factsMock }))

import {
  loadStatusPlanRenderInputs, orderPlans, sourceKindFor, MAX_STATUS_PLANS_PER_REPORT,
} from './plan-render-data'

const PROJ = 'proj-1'
const ORG = 'org-1'
const TODAY = '2026-10-09'

function planRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, project_id: PROJ, organisation_id: ORG, floor_plan_id: 'fp-1', page_index: 1, purpose: 'tenant_layout',
    name: `Plan ${id}`, source_file_path: `${ORG}/${PROJ}/layout.pdf`, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
  }
}
function shapeRow(id: string, plan: string, over: Record<string, unknown> = {}) {
  return {
    id, status_plan_id: plan, shape: 'polygon', points: [0, 0, 200, 0, 200, 100, 0, 100], node_id: null, area_type: null,
    detected_tag: null, source: 'manual', created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
  }
}
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // bytes are not parsed here

function facts() {
  return {
    activeNodes: [
      { id: 'n-done', shopNumber: 'L01', shopName: 'Done Ltd', glaM2: 50, breakerA: null, poleConfig: null, loadA: null },
      { id: 'n-late', shopNumber: 'L02', shopName: 'Late Ltd', glaM2: 50, breakerA: null, poleConfig: null, loadA: null },
    ],
    decommissionedCount: 0,
    scopeTypeIdByKey: { db: 't-db', lighting: 't-l' },
    detailsByNode: new Map([
      ['n-done', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
      ['n-late', { scopeReceived: false, scopeNotRequired: false, layoutIssued: false }],
    ]),
    orderStatusByNodeScope: new Map([['n-done:t-db', 'received'], ['n-done:t-l', 'received']]),
    boByNode: new Map([['n-late', { effectiveDate: '2026-01-01' }]]),
    decommissionedNodeIds: [],
  }
}

function storageFake(files: Record<string, Uint8Array>) {
  const downloads: string[] = []
  return {
    downloads,
    storage: {
      from: (_bucket: string) => ({
        download: async (path: string) => {
          downloads.push(path)
          const f = files[path]
          return f ? { data: new Blob([new Uint8Array(f)]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
    },
  }
}

function world(over: { plans?: any[]; shapes?: any[]; files?: Record<string, Uint8Array>; fps?: any[]; maxRows?: number } = {}) {
  const pg = fakeSupabase({
    maxRows: over.maxRows,
    tables: {
      'projects.projects': [{ id: PROJ, organisation_id: ORG, opening_date: '2026-03-01' }],
      'tenants.status_plans': over.plans ?? [planRow('a')],
      'tenants.status_plan_shapes': over.shapes ?? [],
      'tenants.floor_plans': over.fps ?? [{ id: 'fp-1', name: 'Tenant layout', file_path: `${ORG}/${PROJ}/layout.pdf`, pixels_per_meter: 20 }],
      'tenants.floor_plan_page_scales': [],
      'structure.nodes': [
        { id: 'n-done', project_id: PROJ, kind: 'tenant_db', code: 'TDB-01', shop_number: 'L01', shop_name: 'Done Ltd', name: null, status: 'active' },
        { id: 'n-late', project_id: PROJ, kind: 'tenant_db', code: 'TDB-02', shop_number: 'L02', shop_name: 'Late Ltd', name: null, status: 'active' },
        { id: 'mb', project_id: PROJ, kind: 'main_board', code: 'MB-3.1', shop_number: null, shop_name: null, name: 'MAIN BOARD 3.1', status: 'active' },
      ],
      'structure.scope_item_types': [{ id: 't-db', key: 'db', organisation_id: ORG }],
      'structure.node_orders': [{ id: 'o1', project_id: PROJ, node_id: 'mb', scope_item_type_id: 't-db', status: 'ordered' }],
    },
  })
  const st = storageFake(over.files ?? { [`${ORG}/${PROJ}/layout.pdf`]: PDF })
  return { pg, st, clients: { db: pg.client, facts: pg.client, storage: st.storage } }
}

beforeEach(() => { factsMock.mockReset(); factsMock.mockResolvedValue(facts()) })

describe('pure helpers', () => {
  it('orders tenant layouts before schematics, then by name (numeric), then page', () => {
    const p = (purpose: string, name: string, pageIndex = 1) => ({ purpose, name, pageIndex }) as any
    expect(orderPlans([p('distribution_schematic', 'A'), p('tenant_layout', 'Plan 10'), p('tenant_layout', 'Plan 2'), p('tenant_layout', 'Plan 2', 2)])
      .map((x) => `${x.purpose}:${x.name}:${x.pageIndex}`))
      .toEqual(['tenant_layout:Plan 2:1', 'tenant_layout:Plan 2:2', 'tenant_layout:Plan 10:1', 'distribution_schematic:A:1'])
  })
  it('knows which drawings it can embed', () => {
    expect(sourceKindFor('a/b.PDF')).toBe('pdf')
    expect(sourceKindFor('a/b.png')).toBe('png')
    expect(sourceKindFor('a/b.jpeg')).toBe('jpg')
    expect(sourceKindFor('a/b.webp')).toBeNull()
    expect(sourceKindFor('a/b.dwg')).toBeNull()
  })
})

describe('loadStatusPlanRenderInputs', () => {
  it('styles tenant shapes from live facts through shape-view: complete, overdue, area type, unassigned', async () => {
    const { clients } = world({ shapes: [
      shapeRow('s1', 'a', { node_id: 'n-done' }),
      shapeRow('s2', 'a', { node_id: 'n-late' }),
      shapeRow('s3', 'a', { area_type: 'common' }),
      shapeRow('s4', 'a'),
    ] })
    const { inputs, omitted } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(omitted).toEqual([])
    const [plan] = inputs
    expect(plan!.shapes[0]!.style.fill).toBe(COLOURS.complete)
    expect(plan!.shapes[1]!.style).toEqual(tenantShapeStyle({ status: 'in_progress', overdue: true }))
    expect(plan!.shapes[2]!.style).toEqual(areaShapeStyle('common'))
    // 200 × 100 px at 20 px/m = 10 m × 5 m = 50 m²
    expect(plan!.shapes[0]!.labelLines).toEqual(['L01', 'Done Ltd', '50.0 m²'])
    expect(plan!.shapes[3]!.labelLines).toEqual(['Unassigned', '50.0 m²'])
    expect(plan!.counts).toMatchObject({ complete: 1, in_progress: 1, overdue: 1, common: 1, unlinked: 1, vacant: 0 })
    expect(plan!.measured).toEqual({ totalM2: 100, unmeasured: 0 }) // two linked shops; the mall area is not added
    expect(plan!.generatedOn).toBe(TODAY)
    expect(plan!.source).toEqual({ kind: 'pdf', bytes: PDF, pageIndex: 1, key: `${ORG}/${PROJ}/layout.pdf` })
    expect(plan!.warnings).toEqual([])
  })

  it('hatches schematic blocks from the DB order of any node, without tenant facts', async () => {
    const { clients } = world({
      plans: [planRow('s', { purpose: 'distribution_schematic' })],
      shapes: [
        shapeRow('b1', 's', { shape: 'rect', node_id: 'mb' }),
        shapeRow('b2', 's', { shape: 'rect', node_id: 'n-done' }), // no DB order in node_orders
        shapeRow('b3', 's', { shape: 'rect', detected_tag: 'DB-77' }),
      ],
    })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['distribution_schematic'] })
    expect(inputs[0]!.shapes.map((s) => s.style)).toEqual([dbBlockStyle('ordered'), dbBlockStyle('no_order'), dbBlockStyle('unlinked')])
    expect(inputs[0]!.shapes.map((s) => s.labelLines)).toEqual([['MB-3.1'], ['TDB-01'], ['DB-77']])
    expect(inputs[0]!.counts).toMatchObject({ ordered: 1, no_order: 1, unlinked: 1, required: 0 })
    expect(inputs[0]!.measured).toBeNull()
    expect(factsMock).not.toHaveBeenCalled()
  })

  it('a tenant shape linked to a non-tenant board reads as on screen (not a shop)', async () => {
    const { clients } = world({ shapes: [shapeRow('s1', 'a', { node_id: 'mb' })] })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs[0]!.counts.unlinked).toBe(1)
    expect(inputs[0]!.measured).toEqual({ totalM2: 0, unmeasured: 0 })
  })

  it('an outline that fails today\'s checks is kept, flagged invalid, uncounted, and warned about — never thrown', async () => {
    const { clients } = world({ shapes: [
      shapeRow('ok', 'a', { node_id: 'n-done' }),
      shapeRow('bow', 'a', { node_id: 'n-late', points: [0, 0, 200, 100, 200, 0, 0, 100] }),
      shapeRow('junk', 'a', { points: 'not points' }),
    ] })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    const p = inputs[0]!
    expect(p.shapes.map((s) => s.invalid)).toEqual([false, true, true])
    expect(p.shapes[2]!.points).toEqual([])
    expect(p.counts).toMatchObject({ complete: 1, in_progress: 0, overdue: 0, unlinked: 0 })
    expect(p.measured).toEqual({ totalM2: 50, unmeasured: 0 })
    expect(p.warnings).toEqual(['2 shapes need redrawing: outlined in red where readable, not coloured or counted.'])
  })

  it('reads only the purposes asked for, tenant layouts first', async () => {
    const { clients } = world({ plans: [planRow('z', { purpose: 'distribution_schematic', name: 'A' }), planRow('y', { name: 'B' })] })
    const both = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout', 'distribution_schematic'] })
    expect(both.inputs.map((i) => i.planId)).toEqual(['y', 'z'])
    const one = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(one.inputs.map((i) => i.planId)).toEqual(['y'])
    expect(await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: [] })).toEqual({ inputs: [], omitted: [] })
  })

  it('planIds narrows to the plans asked for (Export sheet, portal)', async () => {
    const { clients } = world({ plans: [planRow('a'), planRow('b')] })
    const r = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'], planIds: ['b'] })
    expect(r.inputs.map((i) => i.planId)).toEqual(['b'])
  })

  it('a missing or unsupported drawing is "not included", the rest still render', async () => {
    const { clients } = world({
      plans: [planRow('a'), planRow('b', { floor_plan_id: 'fp-2' }), planRow('c', { floor_plan_id: 'fp-3' }), planRow('d', { floor_plan_id: 'fp-gone' })],
      fps: [
        { id: 'fp-1', name: 'Tenant layout', file_path: `${ORG}/${PROJ}/layout.pdf`, pixels_per_meter: 20 },
        { id: 'fp-2', name: 'Missing file', file_path: `${ORG}/${PROJ}/missing.pdf`, pixels_per_meter: null },
        { id: 'fp-3', name: 'CAD', file_path: `${ORG}/${PROJ}/layout.dwg`, pixels_per_meter: null },
      ],
    })
    const { inputs, omitted } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs.map((i) => i.planId)).toEqual(['a'])
    expect(omitted).toEqual([
      { title: 'Plan b (Tenant layout, page 1)', reason: 'the drawing file could not be read (Object not found)' },
      { title: 'Plan c (Tenant layout, page 1)', reason: 'the drawing is not a PDF, PNG or JPEG file (layout.dwg)' },
      { title: 'Plan d (Tenant layout, page 1)', reason: 'the drawing is no longer available' },
    ])
  })

  it('downloads a drawing shared by several plans once', async () => {
    const { clients, st } = world({ plans: [planRow('a'), planRow('b', { page_index: 2 })] })
    await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(st.downloads).toHaveLength(1)
  })

  it(`caps at ${MAX_STATUS_PLANS_PER_REPORT} plans and at the byte budget`, async () => {
    const plans = Array.from({ length: MAX_STATUS_PLANS_PER_REPORT + 2 }, (_, i) => planRow(`p${String(i).padStart(2, '0')}`))
    const { clients } = world({ plans })
    const r = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(r.inputs).toHaveLength(MAX_STATUS_PLANS_PER_REPORT)
    expect(r.omitted).toHaveLength(2)
    expect(r.omitted[0]!.reason).toMatch(/more than 20 plans/)
    const small = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'], maxSourceBytes: 2 })
    expect(small.inputs).toHaveLength(0)
    // the two over-count lines come first; every kept plan then hits the byte cap
    expect(small.omitted.filter((o) => /size cap/.test(o.reason))).toHaveLength(MAX_STATUS_PLANS_PER_REPORT)
  })

  it('pages shapes past PostgREST max_rows', async () => {
    const shapes = Array.from({ length: 1500 }, (_, i) => shapeRow(`s${String(i).padStart(4, '0')}`, 'a'))
    const { clients } = world({ shapes, maxRows: 1000 })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs[0]!.shapes).toHaveLength(1500)
  })

  it('page 2 without its own scale is unscaled (the drawing scale is page 1 only)', async () => {
    const { clients } = world({ plans: [planRow('a', { page_index: 2 })], shapes: [shapeRow('s1', 'a', { node_id: 'n-done' })] })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs[0]!.measured).toBeNull()
    expect(inputs[0]!.shapes[0]!.labelLines).toEqual(['L01', 'Done Ltd'])
  })

  it('warns when the drawing changed since the plan was drawn, and when the page has no scale', async () => {
    const { clients } = world({
      plans: [planRow('a', { source_file_path: `${ORG}/${PROJ}/old-layout.pdf` })],
      fps: [{ id: 'fp-1', name: 'Tenant layout', file_path: `${ORG}/${PROJ}/layout.pdf`, pixels_per_meter: null }],
    })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs[0]!.warnings).toEqual([
      'The drawing file changed since this plan was drawn (old-layout.pdf -> layout.pdf); shapes may not line up.',
      'This page has no scale, so areas are not measured.',
    ])
  })

  it('a plan list read error throws (the caller turns it into one "not included" line)', async () => {
    const pg = fakeSupabase({
      tables: { 'projects.projects': [{ id: PROJ, organisation_id: ORG, opening_date: null }] },
      selectErrors: { 'tenants.status_plans': { message: 'boom' } },
    })
    await expect(loadStatusPlanRenderInputs({ db: pg.client, facts: pg.client, storage: storageFake({}).storage }, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] }))
      .rejects.toThrow(/boom/)
  })

  it('a project the caller cannot see yields nothing', async () => {
    const { clients } = world()
    expect(await loadStatusPlanRenderInputs(clients, { projectId: 'other', today: TODAY, purposes: ['tenant_layout'] }))
      .toEqual({ inputs: [], omitted: [] })
  })
})
