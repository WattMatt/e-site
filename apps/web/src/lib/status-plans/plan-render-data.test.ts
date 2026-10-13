// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COLOURS, FEED_UNKNOWN_STYLE, MAIN_BOARD_PALETTE, TENANT_LEGEND, areaShapeStyle, boardShapeStyle, dbBlockStyle, tenantShapeStyle } from '@esite/shared/status-plans'
import { fakeSupabase } from '@/test/fake-supabase'

const factsMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-schedule/shop-facts', () => ({ loadTenantShopFacts: factsMock }))

import {
  loadStatusPlanRenderInputs, orderSheets, sourceKindFor, MAX_PLAN_SHEETS_PER_REPORT,
  MAX_STATUS_PLAN_SOURCE_BYTES, MAX_STATUS_PLAN_TOTAL_BYTES, TENANT_PLAN_FILES,
} from './plan-render-data'

const PROJ = 'proj-1'
const ORG = 'org-1'
const TODAY = '2026-10-09'

function planRow(id: string, over: Record<string, unknown> = {}) {
  return { id, project_id: PROJ, organisation_id: ORG, purpose: 'tenant_layout', name: `Plan ${id}`, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over }
}
const filePath = (plan: string, folder: string, ext = 'pdf') => `${ORG}/${PROJ}/${plan}/${folder}/1.${ext}`
function sheetRow(id: string, plan: string, over: Record<string, unknown> = {}) {
  return { id, status_plan_id: plan, organisation_id: ORG, sort_order: 0, label: `Sheet ${id}`, file_path: filePath(plan, id),
    page_index: 1, file_name: `${id}.pdf`, mime: 'application/pdf', revision: 1, replaced_at: null, replaced_from_path: null,
    pixels_per_meter: 20, calibration_points: [0, 0, 20, 0], calibration_metres: 1, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over }
}
function shapeRow(id: string, plan: string, sheet: string, over: Record<string, unknown> = {}) {
  return { id, status_plan_id: plan, sheet_id: sheet, shape: 'polygon', points: [0, 0, 200, 0, 200, 100, 0, 100], node_id: null,
    area_type: null, detected_tag: null, source: 'manual', created_by: null, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', ...over }
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
  const downloads: Array<[string, string]> = []
  return {
    downloads,
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push([bucket, path])
          const f = files[path]
          return f ? { data: new Blob([new Uint8Array(f)]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
    },
  }
}

function world(over: { plans?: any[]; sheets?: any[]; shapes?: any[]; files?: Record<string, Uint8Array>; maxRows?: number; tables?: Record<string, any[]> } = {}) {
  const sheets = over.sheets ?? [sheetRow('a1', 'a')]
  const pg = fakeSupabase({
    maxRows: over.maxRows,
    tables: {
      'projects.projects': [{ id: PROJ, organisation_id: ORG, opening_date: '2026-03-01' }],
      'tenants.status_plans': over.plans ?? [planRow('a')],
      'tenants.status_plan_sheets': sheets,
      'tenants.status_plan_shapes': over.shapes ?? [],
      'structure.nodes': [
        { id: 'n-done', project_id: PROJ, kind: 'tenant_db', code: 'TDB-01', shop_number: 'L01', shop_name: 'Done Ltd', name: null, status: 'active' },
        { id: 'n-late', project_id: PROJ, kind: 'tenant_db', code: 'TDB-02', shop_number: 'L02', shop_name: 'Late Ltd', name: null, status: 'active' },
        { id: 'mb', project_id: PROJ, kind: 'main_board', code: 'MB-3.1', shop_number: null, shop_name: null, name: 'MAIN BOARD 3.1', status: 'active' },
      ],
      'structure.scope_item_types': [{ id: 't-db', key: 'db', organisation_id: ORG }],
      'structure.node_orders': [{ id: 'o1', project_id: PROJ, node_id: 'mb', scope_item_type_id: 't-db', status: 'ordered' }],
      ...over.tables,
    },
  })
  const st = storageFake(over.files ?? Object.fromEntries(sheets.map((s: any) => [s.file_path, PDF])))
  return { pg, st, clients: { db: pg.client, facts: pg.client, storage: st.storage } }
}

const load = (clients: any, o: Record<string, unknown> = {}) =>
  loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'], ...o })

beforeEach(() => { factsMock.mockReset(); factsMock.mockResolvedValue(facts()) })

describe('pure helpers', () => {
  it('orders floor plan sheets before line diagram sheets, then by sheet position', () => {
    const ref = (purpose: string, plan: string, sort: number) => ({ plan: { id: plan, purpose } as any, row: { id: `${plan}${sort}`, sort_order: sort } as any })
    expect(orderSheets([ref('distribution_schematic', 'z', 0), ref('tenant_layout', 'y', 1), ref('tenant_layout', 'y', 0)]).map((r) => r.row.id))
      .toEqual(['y0', 'y1', 'z0'])
  })
  it('knows which files it can embed', () => {
    expect(sourceKindFor('a/b.pdf')).toBe('pdf')
    expect(sourceKindFor('a/b.png')).toBe('png')
    expect(sourceKindFor('a/b.jpg')).toBe('jpg')
    expect(sourceKindFor('a/b.webp')).toBeNull()
  })
})

describe('loadStatusPlanRenderInputs', () => {
  it('styles floor plan shapes from live facts; reads the sheet from tenant-plan-files', async () => {
    const { clients, st } = world({ shapes: [
      shapeRow('s1', 'a', 'a1', { node_id: 'n-done' }),
      shapeRow('s2', 'a', 'a1', { node_id: 'n-late' }),
      shapeRow('s3', 'a', 'a1', { area_type: 'common' }),
      shapeRow('s4', 'a', 'a1'),
    ] })
    const { inputs, omitted, organisationId } = await load(clients)
    expect(omitted).toEqual([])
    expect(organisationId).toBe(ORG)
    const [s] = inputs
    expect(s).toMatchObject({ planId: 'a', sheetId: 'a1', planName: 'Plan a', sheetLabel: 'Sheet a1', drawingName: 'a1.pdf', pageIndex: 1 })
    expect(s!.shapes[0]!.style.fill).toBe(COLOURS.complete)
    expect(s!.shapes[1]!.style).toEqual(tenantShapeStyle({ status: 'in_progress', overdue: true }))
    expect(s!.shapes[2]!.style).toEqual(areaShapeStyle('common'))
    // 200 × 100 px at 20 px/m = 10 m × 5 m = 50 m²
    expect(s!.shapes[0]!.labelLines).toEqual(['L01', 'Done Ltd', '50.0 m²'])
    expect(s!.counts).toMatchObject({ complete: 1, in_progress: 1, overdue: 1, common: 1, unlinked: 1 })
    expect(s!.measured).toEqual({ totalM2: 100, unmeasured: 0 })
    expect(s!.source).toEqual({ kind: 'pdf', bytes: PDF, pageIndex: 1, key: filePath('a', 'a1') })
    expect(s!.warnings).toEqual([])
    expect(st.downloads).toEqual([[TENANT_PLAN_FILES, filePath('a', 'a1')]])
    expect(TENANT_PLAN_FILES).toBe('tenant-plan-files')
  })

  it('hatches line diagram blocks from the DB order of any node, without tenant facts', async () => {
    const { clients } = world({
      plans: [planRow('s', { purpose: 'distribution_schematic' })],
      sheets: [sheetRow('s1', 's')],
      shapes: [
        shapeRow('b1', 's', 's1', { shape: 'rect', node_id: 'mb' }),
        shapeRow('b2', 's', 's1', { shape: 'rect', node_id: 'n-done' }),
        shapeRow('b3', 's', 's1', { shape: 'rect', detected_tag: 'DB-77' }),
      ],
    })
    const { inputs } = await load(clients, { purposes: ['distribution_schematic'] })
    expect(inputs[0]!.shapes.map((x) => x.style)).toEqual([dbBlockStyle('ordered'), dbBlockStyle('no_order'), dbBlockStyle('unlinked')])
    expect(inputs[0]!.measured).toBeNull()
    expect(factsMock).not.toHaveBeenCalled()
  })

  it('one input per sheet, floor plan first, each sheet with only its own shapes', async () => {
    const { clients } = world({
      plans: [planRow('z', { purpose: 'distribution_schematic' }), planRow('y')],
      sheets: [sheetRow('y1', 'y', { sort_order: 1, page_index: 2, file_path: filePath('y', 'y0') }), sheetRow('y0', 'y'), sheetRow('z0', 'z')],
      shapes: [shapeRow('a', 'y', 'y0'), shapeRow('b', 'y', 'y1'), shapeRow('c', 'y', 'y1')],
    })
    const both = await load(clients, { purposes: ['tenant_layout', 'distribution_schematic'] })
    expect(both.inputs.map((i) => [i.sheetId, i.shapes.length, i.pageIndex])).toEqual([['y0', 1, 1], ['y1', 2, 2], ['z0', 0, 1]])
    const one = await load(clients)
    expect(one.inputs.map((i) => i.sheetId)).toEqual(['y0', 'y1'])
    expect(await load(clients, { purposes: [] })).toEqual({ inputs: [], omitted: [] })
  })

  it('planIds and sheetIds narrow (Export sheet, portal)', async () => {
    const { clients } = world({ plans: [planRow('a'), planRow('b')], sheets: [sheetRow('a1', 'a'), sheetRow('a2', 'a', { sort_order: 1 }), sheetRow('b1', 'b')] })
    expect((await load(clients, { planIds: ['a'] })).inputs.map((i) => i.sheetId)).toEqual(['a1', 'a2'])
    expect((await load(clients, { planIds: ['a'], sheetIds: ['a2'] })).inputs.map((i) => i.sheetId)).toEqual(['a2'])
  })

  it('a file shared by several sheets downloads once', async () => {
    const { clients, st } = world({ sheets: [sheetRow('a1', 'a'), sheetRow('a2', 'a', { sort_order: 1, page_index: 2, file_path: filePath('a', 'a1') })] })
    await load(clients)
    expect(st.downloads).toHaveLength(1)
  })

  it('a missing file is "not included" with a sentence, never storage text; the rest render', async () => {
    const { clients } = world({
      sheets: [sheetRow('a1', 'a'), sheetRow('a2', 'a', { sort_order: 1 })],
      files: { [filePath('a', 'a1')]: PDF },
    })
    const r = await load(clients)
    expect(r.inputs.map((i) => i.sheetId)).toEqual(['a1'])
    expect(r.omitted).toEqual([{ title: 'Plan a (Tenant floor plan, Sheet a2)', reason: 'the sheet file could not be read' }])
    expect(JSON.stringify(r.omitted)).not.toContain('Object not found')
  })

  it(`caps at ${MAX_PLAN_SHEETS_PER_REPORT} sheets and at the byte budget`, async () => {
    const sheets = Array.from({ length: MAX_PLAN_SHEETS_PER_REPORT + 2 }, (_, i) => sheetRow(`s${String(i).padStart(2, '0')}`, 'a', { sort_order: i }))
    const { clients } = world({ sheets })
    const r = await load(clients)
    expect(r.inputs).toHaveLength(MAX_PLAN_SHEETS_PER_REPORT)
    expect(r.omitted).toHaveLength(2)
    expect(r.omitted[0]!.reason).toMatch(/more than 20 sheets/)
    const small = await load(clients, { maxSourceBytes: 2 })
    expect(small.inputs).toHaveLength(0)
    expect(small.omitted.filter((o) => /size cap/.test(o.reason))).toHaveLength(MAX_PLAN_SHEETS_PER_REPORT)
  })

  it('per-file cap is 40 MiB and the total across the appendix is 40 MiB', () => {
    expect(MAX_STATUS_PLAN_SOURCE_BYTES).toBe(40 * 1024 * 1024)
    expect(MAX_STATUS_PLAN_TOTAL_BYTES).toBe(40 * 1024 * 1024)
  })

  it('sheets beyond the total budget become "size cap" lines', async () => {
    const four = new Uint8Array(4)
    const sheets = ['1', '2', '3'].map((n, i) => sheetRow(`s${n}`, 'a', { sort_order: i }))
    const { clients } = world({ sheets, files: Object.fromEntries(sheets.map((s) => [s.file_path, four])) })
    const r = await load(clients, { maxTotalBytes: 9 })
    expect(r.inputs.map((i) => i.sheetId)).toEqual(['s1', 's2'])
    expect(r.omitted).toEqual([{ title: 'Plan a (Tenant floor plan, Sheet s3)', reason: expect.stringMatching(/size cap/) }])
  })

  it('pages shapes past PostgREST max_rows', async () => {
    const shapes = Array.from({ length: 1500 }, (_, i) => shapeRow(`s${String(i).padStart(4, '0')}`, 'a', 'a1'))
    const { clients } = world({ shapes, maxRows: 1000 })
    expect((await load(clients)).inputs[0]!.shapes).toHaveLength(1500)
  })

  it('warns about an unscaled sheet and a replaced file', async () => {
    const { clients } = world({ sheets: [sheetRow('a1', 'a', { pixels_per_meter: null, calibration_points: null, calibration_metres: null, replaced_at: '2026-10-05T00:00:00Z', revision: 3 })] })
    expect((await load(clients)).inputs[0]!.warnings).toEqual([
      'This sheet\'s file was replaced (revision 3) since its shapes were checked; they may not line up.',
      'This sheet has no scale, so areas are not measured.',
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

  it('an invisible project, or a plan with no sheets, yields nothing', async () => {
    const { clients } = world()
    expect(await load(clients, { projectId: 'other' })).toEqual({ inputs: [], omitted: [] })
    const empty = world({ sheets: [] })
    expect(await load(empty.clients)).toEqual({ inputs: [], omitted: [] })
  })
})

describe('colourBy board (floor plan by main board)', () => {
  const FEED_TABLES = {
    'cable_schedule.revisions': [{ id: 'rev-2', project_id: PROJ, code: 'Rev 2', status: 'ISSUED', issued_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' }],
    'cable_schedule.supplies': [{ id: 'sup-1', revision_id: 'rev-2', from_node_id: 'mb', to_node_id: 'n-done' }],
  }

  it('colours linked shops by feeding board, grey when unreached, and names the pages', async () => {
    const { clients } = world({
      tables: FEED_TABLES,
      shapes: [shapeRow('s1', 'a', 'a1', { node_id: 'n-done' }), shapeRow('s2', 'a', 'a1', { node_id: 'n-late' }), shapeRow('s3', 'a', 'a1', { area_type: 'common' })],
    })
    const { inputs, omitted } = await load(clients, { colourBy: 'board' })
    expect(omitted).toEqual([])
    const [s] = inputs
    expect(s!.planName).toBe('Plan a by main board (cable schedule Rev 2)')
    expect(s!.shapes[0]!.style).toEqual(boardShapeStyle(MAIN_BOARD_PALETTE[0]))
    expect(s!.shapes[1]!.style).toEqual(FEED_UNKNOWN_STYLE)
    expect(s!.shapes[2]!.style).toEqual(areaShapeStyle('common'))
    expect(s!.legend.map((e) => e.key)).toEqual(['board:mb', 'feed_unknown', 'unlinked', 'common', 'plant_room', 'services', 'vacant'])
    expect(s!.legend[0]!.label).toBe('MB-3.1 (50.0 m²)')
    expect(s!.counts).toMatchObject({ 'board:mb': 1, feed_unknown: 1, common: 1 })
  })

  it('no cable schedule: the sheet falls back to status colours with the reason in its title', async () => {
    const { clients, st } = world({ shapes: [shapeRow('s1', 'a', 'a1', { node_id: 'n-done' })] })
    const { inputs, omitted } = await load(clients, { colourBy: 'board' })
    expect(omitted).toEqual([])
    expect(inputs).toHaveLength(1)
    expect(inputs[0]!.planName).toBe('Plan a by main board (Main board view unavailable: no cable schedule is visible to you on this project — shown by status)')
    expect(inputs[0]!.legend.map((e) => e.key)).not.toContain('board:mb')
    expect(inputs[0]!.legend).toEqual(TENANT_LEGEND)
    expect(st.downloads.length).toBeGreaterThan(0)
  })

  it('status mode reads no cable schedule at all', async () => {
    const { clients, pg } = world({ tables: FEED_TABLES })
    await load(clients)
    expect(pg.calls.map((c: any) => c.table)).not.toContain('cable_schedule.revisions')
    expect(pg.calls.map((c: any) => c.table)).not.toContain('cable_schedule.supplies')
  })
})
