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
  for (const m of ['schema', 'from', 'select', 'eq', 'in', 'lt', 'order', 'limit', 'update', 'insert', 'delete']) {
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
})

// ─── createValuationAction ──────────────────────────────────────────────────

describe('createValuationAction', () => {
  it('returns the no-import error when there is no current BOQ import', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    boqGetCurrentMock.mockResolvedValue(null)
    createServiceClientMock.mockReturnValue({})

    const res = await createValuationAction(PROJECT, '2026-06-10')

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/Import a BOQ/i)
    expect(createMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('creates a valuation reading retention_pct + the current import behind the gate', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    boqGetCurrentMock.mockResolvedValue({ id: 'imp-current' })
    // Service client resolves the project_settings.retention_pct row.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({ select: () => qb({ data: { retention_pct: 7.5 }, error: null }) }),
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
            qb({ data: { id: VAL, project_id: PROJECT, status: 'certified' }, error: null }),
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
          select: () => qb({ data: { id: VAL, project_id: 'OTHER', status: 'draft' }, error: null }),
        }),
      }),
    })

    const res = await certifyValuationAction(PROJECT, VAL)

    expect('error' in res && res.error).toBe('Not found')
    expect(gatherValuationReportDataMock).not.toHaveBeenCalled()
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
