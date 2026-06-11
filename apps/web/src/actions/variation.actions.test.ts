import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────
// vi.hoisted so the fns exist before the hoisted vi.mock factories reference
// them (the SUT imports next/cache at module load → TDZ trap otherwise).
const {
  createClientMock,
  createServiceClientMock,
  requireEffectiveRoleMock,
  listMock,
  getMock,
  createMock,
  upsertLineMock,
  deleteLineMock,
  approveMock,
  getApprovedAdjustmentsMock,
  boqGetCurrentMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  listMock: vi.fn(),
  getMock: vi.fn(),
  createMock: vi.fn(),
  upsertLineMock: vi.fn(),
  deleteLineMock: vi.fn(),
  approveMock: vi.fn(),
  getApprovedAdjustmentsMock: vi.fn(),
  boqGetCurrentMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  // The pure fns (validateQtyDelta, computeLineChange, computeRevisedItem) stay
  // REAL via the spread — only the service-client methods are mocked.
  variationService: {
    list: listMock,
    get: getMock,
    create: createMock,
    upsertLine: upsertLineMock,
    deleteLine: deleteLineMock,
    approve: approveMock,
    getApprovedAdjustments: getApprovedAdjustmentsMock,
  },
  boqService: { getCurrent: boqGetCurrentMock },
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

import {
  listVariationOrdersAction,
  getVariationOrderAction,
  createVariationOrderAction,
  upsertVariationLineAction,
  deleteVariationLineAction,
  approveVariationOrderAction,
  deleteVariationOrderAction,
} from './variation.actions'

// ─── Chainable + awaitable query-builder stub ───────────────────────────────
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['schema', 'from', 'select', 'eq', 'in', 'lt', 'order', 'limit', 'update', 'insert', 'delete', 'neq']) {
    p[m] = () => qb(result)
  }
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

/** Service client whose schema('projects').from(table) resolves per-table data. */
function serviceWith(tables: Record<string, unknown>) {
  return {
    schema: () => ({
      from: (table: string) => ({
        select: () => qb({ data: tables[table] ?? null, error: null }),
        delete: () => qb({ error: null }),
      }),
    }),
  }
}

const PROJECT = '11111111-1111-1111-1111-111111111111'
const VO = '22222222-2222-2222-2222-222222222222'
const ITEM = '33333333-3333-3333-3333-333333333333'
const SECTION = '44444444-4444-4444-4444-444444444444'
const LINE = '55555555-5555-5555-5555-555555555555'

const draftVo = { id: VO, project_id: PROJECT, status: 'draft', vo_no: 1 }
const approvedVo = { id: VO, project_id: PROJECT, status: 'approved', vo_no: 1 }
const foreignVo = { id: VO, project_id: 'OTHER', status: 'draft', vo_no: 1 }

// quantity 10 @ R100 single → contract amount 1000.
const itemRow = {
  id: ITEM,
  quantity: 10,
  quantity_mode: 'measured',
  amount: 1000,
  supply_rate: null,
  install_rate: null,
  rate: 100,
  rate_model: 'single',
}

const adjustPatch = { kind: 'adjust' as const, boqItemId: ITEM, qtyDelta: -3 }

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
  getApprovedAdjustmentsMock.mockResolvedValue(new Map())
})

// ─── upsertVariationLineAction ──────────────────────────────────────────────

describe('upsertVariationLineAction', () => {
  it('REJECTS an adjust delta that would take the revised quantity below zero, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: draftVo, boq_items: itemRow }))
    // Approved deltas already at −5 → base 10 − 5 = 5; −6 would land at −1.
    getApprovedAdjustmentsMock.mockResolvedValue(new Map([[ITEM, [-5]]]))

    const res = await upsertVariationLineAction(PROJECT, VO, { ...adjustPatch, qtyDelta: -6 })

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toBe('Delta would take the revised quantity below zero')
    expect(upsertLineMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('refuses to edit a line on an APPROVED VO, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: approvedVo, boq_items: itemRow }))

    const res = await upsertVariationLineAction(PROJECT, VO, adjustPatch)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/approved/i)
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('REJECTS a VO belonging to another project, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: foreignVo, boq_items: itemRow }))

    const res = await upsertVariationLineAction(PROJECT, VO, adjustPatch)

    expect('error' in res && res.error).toBe('Not found')
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('REJECTS an update whose line id belongs to a DIFFERENT VO, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({
        variation_orders: draftVo,
        boq_items: itemRow,
        variation_lines: { id: LINE, variation_order_id: 'OTHER-VO' },
      }),
    )

    const res = await upsertVariationLineAction(PROJECT, VO, { ...adjustPatch, id: LINE })

    expect('error' in res && res.error).toBe('Not found')
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('upserts an adjust line within the floor, passing the boq item rates through', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: draftVo, boq_items: itemRow }))
    getApprovedAdjustmentsMock.mockResolvedValue(new Map([[ITEM, [-5]]]))
    upsertLineMock.mockResolvedValue({ id: LINE, kind: 'adjust', valueChange: -300 })

    const res = await upsertVariationLineAction(PROJECT, VO, adjustPatch)

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.line).toMatchObject({ id: LINE })
    expect(upsertLineMock).toHaveBeenCalledWith(
      expect.anything(),
      VO,
      expect.objectContaining({ kind: 'adjust', boqItemId: ITEM, qtyDelta: -3 }),
      expect.objectContaining({ rate: 100, rateModel: 'single' }),
    )
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('upserts an add line after verifying its section belongs to the current import', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({
        variation_orders: draftVo,
        boq_sections: { id: SECTION, import_id: 'imp-1' },
      }),
    )
    boqGetCurrentMock.mockResolvedValue({ id: 'imp-1' })
    upsertLineMock.mockResolvedValue({ id: LINE, kind: 'add', valueChange: 500 })

    const res = await upsertVariationLineAction(PROJECT, VO, {
      kind: 'add',
      sectionId: SECTION,
      description: 'Extra DB',
      quantity: 5,
      rateModel: 'single',
      rate: 100,
    })

    expect('data' in res).toBe(true)
    expect(upsertLineMock).toHaveBeenCalledWith(
      expect.anything(),
      VO,
      expect.objectContaining({ kind: 'add', sectionId: SECTION }),
    )
  })

  it('REJECTS an add line whose section belongs to another import/project', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({
        variation_orders: draftVo,
        boq_sections: { id: SECTION, import_id: 'imp-FOREIGN' },
      }),
    )
    boqGetCurrentMock.mockResolvedValue({ id: 'imp-1' })

    const res = await upsertVariationLineAction(PROJECT, VO, {
      kind: 'add',
      sectionId: SECTION,
      description: 'Extra DB',
      quantity: 5,
      rateModel: 'single',
      rate: 100,
    })

    expect('error' in res && res.error).toBe('Not found')
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('returns the gate error when the role gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await upsertVariationLineAction(PROJECT, VO, adjustPatch)

    expect('error' in res && res.error).toBe('No access to this project')
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

// ─── createVariationOrderAction ─────────────────────────────────────────────

describe('createVariationOrderAction', () => {
  const cookieClient = {
    schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
  }

  it('returns the no-import error when there is no current BOQ import', async () => {
    createClientMock.mockResolvedValue(cookieClient)
    createServiceClientMock.mockReturnValue({})
    boqGetCurrentMock.mockResolvedValue(null)

    const res = await createVariationOrderAction(PROJECT, { voDate: '2026-06-11', title: 'VO 1', reason: null })

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toBe('Import a BOQ on the Rates tab first')
    expect(createMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('creates a VO against the current import with createdBy from auth', async () => {
    createClientMock.mockResolvedValue(cookieClient)
    createServiceClientMock.mockReturnValue({})
    boqGetCurrentMock.mockResolvedValue({ id: 'imp-current' })
    createMock.mockResolvedValue({ id: VO, voNo: 1 })

    const res = await createVariationOrderAction(PROJECT, {
      voDate: '2026-06-11',
      title: 'Remeasure — Block A',
      reason: 'Site remeasure',
    })

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.vo).toMatchObject({ id: VO })
    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: PROJECT,
        organisationId: 'org-1',
        boqImportId: 'imp-current',
        voDate: '2026-06-11',
        title: 'Remeasure — Block A',
        reason: 'Site remeasure',
        createdBy: 'u-1',
      }),
    )
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

// ─── approveVariationOrderAction ────────────────────────────────────────────

describe('approveVariationOrderAction', () => {
  it('refuses an already-approved VO, without re-approving', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: approvedVo }))

    const res = await approveVariationOrderAction(PROJECT, VO)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/already approved/i)
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('REJECTS a VO belonging to another project, without writing', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: foreignVo }))

    const res = await approveVariationOrderAction(PROJECT, VO)

    expect('error' in res && res.error).toBe('Not found')
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('approves a draft VO and revalidates the variations + rates + valuations paths', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-approver' } } }) },
    })
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: draftVo }))
    approveMock.mockResolvedValue({ id: VO, status: 'approved', netChange: 2500 })

    const res = await approveVariationOrderAction(PROJECT, VO)

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.vo).toMatchObject({ status: 'approved' })
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), VO, { approvedBy: 'u-approver' })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT}/settings/variations`, 'page')
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT}/settings/rates`, 'page')
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT}/settings/valuations`, 'page')
  })
})

// ─── deleteVariationLineAction ──────────────────────────────────────────────

describe('deleteVariationLineAction', () => {
  it('REJECTS a line that does not belong to the VO, without deleting', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({
        variation_orders: draftVo,
        variation_lines: { id: LINE, variation_order_id: 'OTHER-VO' },
      }),
    )

    const res = await deleteVariationLineAction(PROJECT, VO, LINE)

    expect('error' in res && res.error).toBe('Not found')
    expect(deleteLineMock).not.toHaveBeenCalled()
  })

  it('refuses to delete a line on an APPROVED VO', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({
        variation_orders: approvedVo,
        variation_lines: { id: LINE, variation_order_id: VO },
      }),
    )

    const res = await deleteVariationLineAction(PROJECT, VO, LINE)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/approved/i)
    expect(deleteLineMock).not.toHaveBeenCalled()
  })

  it('deletes a draft VO line that belongs to the VO', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({
        variation_orders: draftVo,
        variation_lines: { id: LINE, variation_order_id: VO },
      }),
    )
    deleteLineMock.mockResolvedValue(undefined)

    const res = await deleteVariationLineAction(PROJECT, VO, LINE)

    expect('data' in res).toBe(true)
    expect(deleteLineMock).toHaveBeenCalledWith(expect.anything(), LINE)
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

// ─── deleteVariationOrderAction ─────────────────────────────────────────────

describe('deleteVariationOrderAction', () => {
  it('refuses to delete an APPROVED VO', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: approvedVo }))

    const res = await deleteVariationOrderAction(PROJECT, VO)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/approved/i)
  })

  it('REJECTS a VO belonging to another project', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: foreignVo }))

    const res = await deleteVariationOrderAction(PROJECT, VO)

    expect('error' in res && res.error).toBe('Not found')
  })

  it('returns the gate error when the write-role gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await deleteVariationOrderAction(PROJECT, VO)

    expect('error' in res && res.error).toBe('No access to this project')
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('deletes a draft VO', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(serviceWith({ variation_orders: draftVo }))

    const res = await deleteVariationOrderAction(PROJECT, VO)

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.deleted).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

// ─── listVariationOrdersAction ──────────────────────────────────────────────

describe('listVariationOrdersAction', () => {
  it('lists VOs behind the gate', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({})
    listMock.mockResolvedValue([{ id: VO, voNo: 1 }])

    const res = await listVariationOrdersAction(PROJECT)

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.vos).toHaveLength(1)
    expect(listMock).toHaveBeenCalledWith(expect.anything(), PROJECT)
  })

  it('returns the gate error when the gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await listVariationOrdersAction(PROJECT)

    expect('error' in res && res.error).toBe('No access to this project')
    expect(listMock).not.toHaveBeenCalled()
  })
})

// ─── getVariationOrderAction ────────────────────────────────────────────────

describe('getVariationOrderAction', () => {
  it('REJECTS a foreign VO', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({})
    getMock.mockResolvedValue({
      vo: { id: VO, projectId: 'OTHER', status: 'draft', approvedBy: null },
      lines: [],
    })

    const res = await getVariationOrderAction(PROJECT, VO)

    expect('error' in res && res.error).toBe('Not found')
  })

  it('returns the VO with a live netChange = Σ value_change', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue(
      serviceWith({ variation_orders: { created_by: null } }),
    )
    getMock.mockResolvedValue({
      vo: { id: VO, projectId: PROJECT, status: 'draft', approvedBy: null, netChange: null },
      lines: [{ id: 'l1', valueChange: 100.5 }, { id: 'l2', valueChange: -40.25 }],
    })

    const res = await getVariationOrderAction(PROJECT, VO)

    expect('data' in res).toBe(true)
    if ('data' in res) {
      expect(res.data.netChange).toBe(60.25)
      expect(res.data.lines).toHaveLength(2)
    }
  })
})
