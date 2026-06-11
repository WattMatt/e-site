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
  setSectionPercentMock,
  certifyMock,
  getPreviousNetMock,
  boqGetCurrentMock,
  boqGetTreeMock,
  getApprovedAdjustmentsMock,
  computeCertificateMock,
  gatherValuationReportDataMock,
  renderValuationReportMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  listMock: vi.fn(),
  getMock: vi.fn(),
  createMock: vi.fn(),
  upsertLineMock: vi.fn(),
  setSectionPercentMock: vi.fn(),
  certifyMock: vi.fn(),
  getPreviousNetMock: vi.fn(),
  boqGetCurrentMock: vi.fn(),
  boqGetTreeMock: vi.fn(),
  getApprovedAdjustmentsMock: vi.fn(),
  computeCertificateMock: vi.fn(),
  gatherValuationReportDataMock: vi.fn(),
  renderValuationReportMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  valuationService: {
    list: listMock,
    get: getMock,
    create: createMock,
    upsertLine: upsertLineMock,
    setSectionPercent: setSectionPercentMock,
    certify: certifyMock,
    getPreviousNet: getPreviousNetMock,
  },
  boqService: {
    getCurrent: boqGetCurrentMock,
    getTree: boqGetTreeMock,
  },
  // computeRevisedItem stays REAL via the spread — only the service-client
  // method is mocked.
  variationService: {
    getApprovedAdjustments: getApprovedAdjustmentsMock,
  },
  computeCertificate: computeCertificateMock,
}))
vi.mock('@/lib/reports/valuation-report-data', () => ({
  gatherValuationReportData: gatherValuationReportDataMock,
}))
vi.mock('@/lib/reports/render-valuation', () => ({
  renderValuationReport: renderValuationReportMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

import {
  listValuationsAction,
  getValuationAction,
  createValuationAction,
  updateValuationLineAction,
  setSectionPercentAction,
  certifyValuationAction,
  deleteValuationAction,
} from './valuation.actions'

// ─── Chainable + awaitable query-builder stub ───────────────────────────────
// Returns a Promise (so `await qb(r)` === r) that also exposes the supabase
// chain methods. Terminal single/maybeSingle resolve to the result directly.
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['schema', 'from', 'select', 'eq', 'in', 'lt', 'order', 'limit', 'update', 'insert', 'delete', 'neq']) {
    p[m] = () => qb(result)
  }
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

const PROJECT = '11111111-1111-1111-1111-111111111111'
const VAL = '22222222-2222-2222-2222-222222222222'
const ITEM = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
  getApprovedAdjustmentsMock.mockResolvedValue(new Map())
})

// ─── updateValuationLineAction — cross-project guard ────────────────────────

describe('updateValuationLineAction — cross-project guard', () => {
  const patch = { boqItemId: ITEM, inputMethod: 'percent' as const, percentComplete: 50 }

  it('REJECTS a line edit when the valuation belongs to another project, without writing', async () => {
    createClientMock.mockResolvedValue({})
    // SERVICE client resolves the valuation to a different project + the boq item.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => ({
          select: () =>
            qb({
              data:
                table === 'valuations'
                  ? { id: VAL, project_id: 'OTHER', status: 'draft' }
                  : { id: ITEM },
              error: null,
            }),
        }),
      }),
    })

    const res = await updateValuationLineAction(PROJECT, VAL, patch)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toBe('Not found')
    expect(upsertLineMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('REJECTS when the valuation id resolves to nothing, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: null, error: null }) }) }),
    })

    const res = await updateValuationLineAction(PROJECT, 'ghost', patch)

    expect('error' in res && res.error).toBe('Not found')
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('refuses to edit a line on a CERTIFIED valuation, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () =>
            qb({ data: { id: VAL, project_id: PROJECT, status: 'certified' }, error: null }),
        }),
      }),
    })

    const res = await updateValuationLineAction(PROJECT, VAL, patch)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/certified/i)
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('upserts when the valuation belongs to this project and is draft', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => ({
          select: () =>
            qb({
              data:
                table === 'valuations'
                  ? { id: VAL, project_id: PROJECT, status: 'draft' }
                  : {
                      id: ITEM,
                      amount: 1000,
                      supply_rate: null,
                      install_rate: null,
                      rate: null,
                      rate_model: 'amount_only',
                    },
              error: null,
            }),
        }),
      }),
    })
    upsertLineMock.mockResolvedValue({ id: 'line-1', valueToDate: 500 })

    const res = await updateValuationLineAction(PROJECT, VAL, patch)

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.line).toMatchObject({ id: 'line-1' })
    expect(upsertLineMock).toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('returns the gate error when the role gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await updateValuationLineAction(PROJECT, VAL, patch)

    expect('error' in res && res.error).toBe('No access to this project')
    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(upsertLineMock).not.toHaveBeenCalled()
  })

  it('passes the REVISED cap through when approved adjustments raise the item quantity', async () => {
    createClientMock.mockResolvedValue({})
    // Item: qty 10 @ R100 single → contract amount 1000. Approved delta +5 →
    // revised qty 15 / revised amount 1500. A qtyComplete of 12 (R1200) exceeds
    // contract but sits within revised — the revised position must reach
    // valuationService.upsertLine so computeLineValue caps at 1500, not 1000.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => ({
          select: () =>
            qb({
              data:
                table === 'valuations'
                  ? { id: VAL, project_id: PROJECT, status: 'draft' }
                  : {
                      id: ITEM,
                      quantity: 10,
                      quantity_mode: 'measured',
                      amount: 1000,
                      supply_rate: null,
                      install_rate: null,
                      rate: 100,
                      rate_model: 'single',
                    },
              error: null,
            }),
        }),
      }),
    })
    getApprovedAdjustmentsMock.mockResolvedValue(new Map([[ITEM, [5]]]))
    upsertLineMock.mockResolvedValue({ id: 'line-1', valueToDate: 1200 })

    const res = await updateValuationLineAction(PROJECT, VAL, {
      boqItemId: ITEM,
      inputMethod: 'quantity',
      qtyComplete: 12,
    })

    expect('data' in res).toBe(true)
    expect(upsertLineMock).toHaveBeenCalledWith(
      expect.anything(),
      VAL,
      expect.objectContaining({ qtyComplete: 12 }),
      expect.objectContaining({ amount: 1000 }),
      { revisedQty: 15, revisedAmount: 1500 },
    )
  })

  it('passes NO revised position when the item has no approved adjustments', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => ({
          select: () =>
            qb({
              data:
                table === 'valuations'
                  ? { id: VAL, project_id: PROJECT, status: 'draft' }
                  : {
                      id: ITEM,
                      quantity: 10,
                      quantity_mode: 'measured',
                      amount: 1000,
                      supply_rate: null,
                      install_rate: null,
                      rate: 100,
                      rate_model: 'single',
                    },
              error: null,
            }),
        }),
      }),
    })
    upsertLineMock.mockResolvedValue({ id: 'line-1', valueToDate: 1000 })

    const res = await updateValuationLineAction(PROJECT, VAL, {
      boqItemId: ITEM,
      inputMethod: 'quantity',
      qtyComplete: 12,
    })

    expect('data' in res).toBe(true)
    expect(upsertLineMock).toHaveBeenCalledWith(
      expect.anything(),
      VAL,
      expect.objectContaining({ qtyComplete: 12 }),
      expect.objectContaining({ amount: 1000 }),
      undefined,
    )
  })
})

// ─── createValuationAction ──────────────────────────────────────────────────

describe('createValuationAction', () => {
  it('returns the no-import error when there is no current BOQ import', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    boqGetCurrentMock.mockResolvedValue(null)
    // No existing draft — draft-check returns null; getCurrent returns null after.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => ({
          select: () => qb({ data: table === 'valuations' ? null : { retention_pct: 5 }, error: null }),
        }),
      }),
    })

    const res = await createValuationAction(PROJECT, '2026-06-10')

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/Import a BOQ/i)
    expect(createMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('returns the "finish the current draft" error (and does NOT call create) when a draft valuation exists for the project', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    // Service client: draft-check finds an existing draft.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({ select: () => qb({ data: { id: 'val-existing' }, error: null }) }),
      }),
    })

    const res = await createValuationAction(PROJECT, '2026-06-10')

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/Finish.*draft/i)
    expect(createMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('creates a valuation reading retention_pct + the current import behind the gate', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    boqGetCurrentMock.mockResolvedValue({ id: 'imp-current' })
    // Service client: draft-check returns null (no blocking draft); project_settings returns retention_pct.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => ({
          select: () => qb({
            data: table === 'valuations' ? null : { retention_pct: 7.5 },
            error: null,
          }),
        }),
      }),
    })
    createMock.mockResolvedValue({ id: 'val-new', valuationNo: 1 })

    const res = await createValuationAction(PROJECT, '2026-06-10')

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.valuation).toMatchObject({ id: 'val-new' })
    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: PROJECT,
        organisationId: 'org-1',
        boqImportId: 'imp-current',
        valuationDate: '2026-06-10',
        retentionPct: 7.5,
        createdBy: 'u-1',
      }),
    )
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

// ─── certifyValuationAction ─────────────────────────────────────────────────

describe('certifyValuationAction', () => {
  it('refuses to certify an already-certified valuation, without rendering or persisting', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () =>
            qb({ data: { id: VAL, project_id: PROJECT, status: 'certified', valuation_no: 1 }, error: null }),
        }),
      }),
    })

    const res = await certifyValuationAction(PROJECT, VAL)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/certified/i)
    expect(gatherValuationReportDataMock).not.toHaveBeenCalled()
    expect(renderValuationReportMock).not.toHaveBeenCalled()
    expect(certifyMock).not.toHaveBeenCalled()
  })

  it('REJECTS a foreign valuation without rendering', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () => qb({ data: { id: VAL, project_id: 'OTHER', status: 'draft', valuation_no: 1 }, error: null }),
        }),
      }),
    })

    const res = await certifyValuationAction(PROJECT, VAL)

    expect('error' in res && res.error).toBe('Not found')
    expect(gatherValuationReportDataMock).not.toHaveBeenCalled()
  })

  it('returns the "certify earlier valuations first" error (and does NOT call render/certify) when a lower-valuation_no valuation is still draft', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    // resolveValuationForGate: valuation_no = 2 (draft).
    // sequence-check: finds an earlier uncertified row.
    let valuationsCallCount = 0
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => {
          if (table === 'valuations') {
            valuationsCallCount++
            if (valuationsCallCount === 1) {
              // resolveValuationForGate
              return {
                select: () =>
                  qb({ data: { id: VAL, project_id: PROJECT, status: 'draft', valuation_no: 2 }, error: null }),
              }
            }
            // Guard 2 sequence-check — earlier uncertified valuation exists
            return {
              select: () => qb({ data: { id: 'val-1' }, error: null }),
            }
          }
          return { select: () => qb({ data: null, error: null }) }
        },
      }),
    })

    const res = await certifyValuationAction(PROJECT, VAL)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/Certify earlier/i)
    expect(gatherValuationReportDataMock).not.toHaveBeenCalled()
    expect(renderValuationReportMock).not.toHaveBeenCalled()
    expect(certifyMock).not.toHaveBeenCalled()
  })

  it('SUCCESS — certifies a draft valuation: figures come from the gatherer summary, render fires, certify is called, path is revalidated', async () => {
    const fakeFigures = { gross: 10000, retention: 500, net: 9500, previousNet: 0, thisCertificate: 9500 }
    const fakeSummary = fakeFigures
    const fakeBuffer = Buffer.from('PDF')
    const fakeValuation = { id: VAL, projectId: PROJECT, status: 'certified', valuationNo: 1 }

    // Cookie client: resolveProjectOrg + auth.getUser
    createClientMock.mockResolvedValue({
      schema: () => ({
        from: () => ({
          select: () => qb({ data: { organisation_id: 'org-1' }, error: null }),
        }),
      }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-certifier' } } }) },
    })

    // Service client: resolveValuationForGate → draft row (valuation_no: 1);
    // sequence-check → null (no earlier uncertified, since valuation_no: 1 means lt(1) is empty);
    // supersede-check → null (no prior report); insert reports row → { id: 'report-1' };
    // supersede UPDATE (.neq) → no error.
    let valuationsCallCount = 0
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: (table: string) => {
          if (table === 'valuations') {
            valuationsCallCount++
            if (valuationsCallCount === 1) {
              // resolveValuationForGate
              return {
                select: () =>
                  qb({ data: { id: VAL, project_id: PROJECT, status: 'draft', valuation_no: 1 }, error: null }),
              }
            }
            // Guard 2 sequence-check — no earlier uncertified (valuation_no 1 has no predecessors)
            return {
              select: () => qb({ data: null, error: null }),
            }
          }
          // reports table: supersede-check maybeSingle returns null; insert returns { id }
          return {
            select: () => ({
              ...qb({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: 'report-1' }, error: null }),
              }),
            }),
            update: () => qb({ error: null }),
          }
        },
      }),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          remove: async () => ({}),
        }),
      },
    })

    gatherValuationReportDataMock.mockResolvedValue({
      summary: fakeSummary,
      valuation: { no: 1 },
      branding: {
        accent: '#f59e0b',
        issuer: { wordmark: 'WM Consulting' },
        kicker: 'Payment Certificate',
        projectLine: 'Kings Walk',
      },
    })
    renderValuationReportMock.mockResolvedValue(fakeBuffer)
    certifyMock.mockResolvedValue(fakeValuation)

    const res = await certifyValuationAction(PROJECT, VAL)

    expect('data' in res).toBe(true)
    if ('data' in res) {
      expect(res.data.reportId).toBe('report-1')
      expect(res.data.valuation).toMatchObject({ status: 'certified' })
    }

    // The frozen figures passed to certify must be the gatherer's summary verbatim.
    expect(certifyMock).toHaveBeenCalledWith(
      expect.anything(),
      VAL,
      expect.objectContaining({ figures: fakeSummary }),
    )
    expect(renderValuationReportMock).toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

// ─── deleteValuationAction ──────────────────────────────────────────────────

describe('deleteValuationAction', () => {
  it('refuses to delete a CERTIFIED valuation', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () =>
            qb({ data: { id: VAL, project_id: PROJECT, status: 'certified' }, error: null }),
        }),
      }),
    })

    const res = await deleteValuationAction(PROJECT, VAL)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/certified/i)
  })

  it('refuses a valuation belonging to another project', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () => qb({ data: { id: VAL, project_id: 'OTHER', status: 'draft' }, error: null }),
        }),
      }),
    })

    const res = await deleteValuationAction(PROJECT, VAL)

    expect('error' in res && res.error).toBe('Not found')
  })

  it('returns the gate error when the write-role gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await deleteValuationAction(PROJECT, VAL)

    expect('error' in res && res.error).toBe('No access to this project')
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

// ─── setSectionPercentAction — cross-project + certified guard ──────────────

describe('setSectionPercentAction', () => {
  it('refuses a certified valuation, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () =>
            qb({ data: { id: VAL, project_id: PROJECT, status: 'certified' }, error: null }),
        }),
      }),
    })

    const res = await setSectionPercentAction(PROJECT, VAL, 'sec-1', 50)

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/certified/i)
    expect(setSectionPercentMock).not.toHaveBeenCalled()
  })
})

// ─── listValuationsAction ───────────────────────────────────────────────────

describe('listValuationsAction', () => {
  it('lists valuations behind the gate', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({})
    listMock.mockResolvedValue([{ id: VAL, valuationNo: 1 }])

    const res = await listValuationsAction(PROJECT)

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.valuations).toHaveLength(1)
    expect(listMock).toHaveBeenCalledWith(expect.anything(), PROJECT)
  })

  it('returns the gate error when the gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await listValuationsAction(PROJECT)

    expect('error' in res && res.error).toBe('No access to this project')
    expect(listMock).not.toHaveBeenCalled()
  })
})

// ─── getValuationAction ─────────────────────────────────────────────────────

describe('getValuationAction', () => {
  it('REJECTS a foreign valuation', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({})
    getMock.mockResolvedValue({
      valuation: { id: VAL, projectId: 'OTHER', valuationNo: 2, certifiedBy: null, status: 'draft' },
      lines: [],
    })

    const res = await getValuationAction(PROJECT, VAL)

    expect('error' in res && res.error).toBe('Not found')
  })
})
