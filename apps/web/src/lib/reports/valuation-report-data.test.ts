/**
 * valuation-report-data.test.ts
 *
 * Tests gatherValuationReportData using mocked Supabase clients + mocked
 * valuationService/boqService. The CERTIFICATE MATH is asserted against the
 * REAL computeCertificate, and the per-bill breakdown is asserted to
 * reconcile to summary.grossToDate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeCertificate } from '@esite/shared'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be vi.hoisted() to avoid TDZ with top-level vi.mock()
// ---------------------------------------------------------------------------

const {
  mockRequireEffectiveRole,
  mockCreateServiceClient,
  mockValuationGet,
  mockValuationGetPreviousNet,
  mockBoqGetTree,
} = vi.hoisted(() => ({
  mockRequireEffectiveRole: vi.fn(),
  mockCreateServiceClient: vi.fn(),
  mockValuationGet: vi.fn(),
  mockValuationGetPreviousNet: vi.fn(),
  mockBoqGetTree: vi.fn(),
}))

vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: mockRequireEffectiveRole,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockCreateServiceClient,
}))

// Mock only the service methods the gatherer calls — keep the REAL
// computeCertificate (imported above) so the math wiring is genuinely tested.
vi.mock('@esite/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@esite/shared')>()
  return {
    ...actual,
    valuationService: {
      get: mockValuationGet,
      getPreviousNet: mockValuationGetPreviousNet,
    },
    boqService: {
      getTree: mockBoqGetTree,
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-001'
const VALUATION_ID = 'val-002'
const USER_ID = 'user-001'

const PROJECT_ROW = {
  id: PROJECT_ID,
  name: 'Kingswalk Mall',
  organisation_id: 'org-001',
  client_logo_url: null,
  project_logo_url: null,
  report_accent_color: '#0055AA',
  status: 'active',
}

const ORG_ROW = {
  id: 'org-001',
  name: 'WM Consulting',
  logo_url: null,
  report_accent_color: null,
}

const PROFILES = [
  { id: 'user-certifier', full_name: 'Pat Engineer', email: 'pat@example.com' },
]

// BOQ tree: two bills.
//   Bill A (kind=bill)
//     └ Section A1 (kind=section)
//         · item-a1 (in Section A1)
//   Bill B (kind=bill)
//     · item-b1 (directly in Bill B)
const SECTIONS = [
  { id: 'bill-a', importId: 'imp-1', parentSectionId: null, kind: 'bill', code: 'A', title: 'Bill A — Electrical', sortOrder: 0, nodeId: null },
  { id: 'sec-a1', importId: 'imp-1', parentSectionId: 'bill-a', kind: 'section', code: 'A1', title: 'LV Reticulation', sortOrder: 1, nodeId: null },
  { id: 'bill-b', importId: 'imp-1', parentSectionId: null, kind: 'bill', code: 'B', title: 'Bill B — Generators', sortOrder: 2, nodeId: null },
]

const ITEMS = [
  { id: 'item-a1', sectionId: 'sec-a1', code: 'A1.1', description: 'Cable', unit: 'm', quantity: 100, quantityMode: 'measured', rateModel: 'single', supplyRate: null, installRate: null, rate: 10, amount: 1000, sortOrder: 0 },
  { id: 'item-b1', sectionId: 'bill-b', code: 'B.1', description: 'Genset', unit: 'no', quantity: 1, quantityMode: 'measured', rateModel: 'single', supplyRate: null, installRate: null, rate: 500, amount: 500, sortOrder: 0 },
]

// Two valuation lines — one per bill.
const VAL_LINES = [
  { id: 'vl-1', valuationId: VALUATION_ID, boqItemId: 'item-a1', inputMethod: 'percent', percentComplete: 50, qtyComplete: null, valueToDate: 500 },
  { id: 'vl-2', valuationId: VALUATION_ID, boqItemId: 'item-b1', inputMethod: 'percent', percentComplete: 40, qtyComplete: null, valueToDate: 200 },
]

const VALUATION_ROW = {
  id: VALUATION_ID,
  projectId: PROJECT_ID,
  organisationId: 'org-001',
  boqImportId: 'imp-1',
  valuationNo: 2,
  valuationDate: '2026-06-10',
  status: 'draft',
  retentionPct: 10,
  grossToDate: null,
  retentionAmount: null,
  netToDate: null,
  previousNet: null,
  dueExVat: null,
  vatAmount: null,
  dueInclVat: null,
  reportId: null,
  notes: null,
  certifiedBy: 'user-certifier',
  certifiedAt: null,
}

const PREVIOUS_NET = 100

// ---------------------------------------------------------------------------
// Service-client builder (handles the project/org/profiles reads only —
// valuation + BOQ reads go through the mocked services).
// ---------------------------------------------------------------------------

function buildServiceMock() {
  function makeQuery(result: unknown) {
    const q: any = {
      schema: () => q,
      from: () => q,
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      maybeSingle: () => Promise.resolve({ data: result, error: null }),
      single: () => Promise.resolve({ data: result, error: null }),
      then: (resolve: any) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return q
  }

  return {
    schema: (name: string) => ({
      from: (table: string) => {
        if (name === 'projects' && table === 'projects') return makeQuery(PROJECT_ROW)
        return makeQuery(null)
      },
    }),
    from: (table: string) => {
      if (table === 'organisations') return makeQuery(ORG_ROW)
      if (table === 'profiles') {
        const q: any = {
          select: () => q,
          in: () => q,
          then: (resolve: any) => Promise.resolve({ data: PROFILES, error: null }).then(resolve),
        }
        return q
      }
      return makeQuery(null)
    },
    // storage unused for the certificate (no photos) — provide a stub anyway.
    storage: {
      from: () => ({ download: async () => ({ data: null, error: 'not found' }) }),
    },
  }
}

function buildCookieMock() {
  return { auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gatherValuationReportData', () => {
  beforeEach(() => {
    mockRequireEffectiveRole.mockResolvedValue({ ok: true, role: 'project_manager' })
    mockCreateServiceClient.mockReturnValue(buildServiceMock())
    mockValuationGet.mockResolvedValue({ valuation: VALUATION_ROW, lines: VAL_LINES })
    mockValuationGetPreviousNet.mockResolvedValue(PREVIOUS_NET)
    mockBoqGetTree.mockResolvedValue({ sections: SECTIONS, items: ITEMS })
  })

  it('rejects when the caller lacks the cost-view role', async () => {
    mockRequireEffectiveRole.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    const { gatherValuationReportData } = await import('./valuation-report-data')
    await expect(
      gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID),
    ).rejects.toThrow(/not allowed/)
  })

  it('gates on COST_VIEW_ROLES', async () => {
    const { gatherValuationReportData } = await import('./valuation-report-data')
    await gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID)
    const allowed = mockRequireEffectiveRole.mock.calls[0][2]
    expect([...allowed].sort()).toEqual(['admin', 'owner', 'project_manager'])
  })

  it('throws when the valuation is not found', async () => {
    mockValuationGet.mockResolvedValue(null)
    const { gatherValuationReportData } = await import('./valuation-report-data')
    await expect(
      gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID),
    ).rejects.toThrow(/not found/i)
  })

  it('summary equals computeCertificate(lines, retentionPct, previousNet)', async () => {
    const { gatherValuationReportData } = await import('./valuation-report-data')
    const data = await gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID)

    const expected = computeCertificate(
      VAL_LINES.map(l => ({ valueToDate: l.valueToDate })),
      VALUATION_ROW.retentionPct,
      PREVIOUS_NET,
    )
    expect(data.summary).toEqual(expected)
    // Spot-check concrete numbers: gross 700, ret 70, net 630, prev 100,
    // dueEx 530, vat 79.5, incl 609.5
    expect(data.summary.grossToDate).toBe(700)
    expect(data.summary.retention).toBe(70)
    expect(data.summary.netToDate).toBe(630)
    expect(data.summary.previousNet).toBe(100)
    expect(data.summary.dueExVat).toBe(530)
    expect(data.summary.vat).toBe(79.5)
    expect(data.summary.dueInclVat).toBe(609.5)
  })

  it('builds a per-bill breakdown whose grosses reconcile to summary.grossToDate', async () => {
    const { gatherValuationReportData } = await import('./valuation-report-data')
    const data = await gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID)

    // Two bills, each carrying one line.
    expect(data.bills).toHaveLength(2)
    const billA = data.bills.find(b => b.code === 'A')!
    const billB = data.bills.find(b => b.code === 'B')!
    expect(billA.grossToDate).toBe(500) // item-a1 (nested under section A1)
    expect(billB.grossToDate).toBe(200) // item-b1 (directly under Bill B)

    // RECONCILIATION: per-bill grosses sum to summary.grossToDate.
    const sum = Math.round(data.bills.reduce((s, b) => s + b.grossToDate, 0) * 100) / 100
    expect(sum).toBe(data.summary.grossToDate)

    // Per-bill retention also ties (each bill * retentionPct).
    expect(billA.retention).toBe(50)
    expect(billB.retention).toBe(20)
  })

  it('exposes the valuation header (no, date, status, retentionPct)', async () => {
    const { gatherValuationReportData } = await import('./valuation-report-data')
    const data = await gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID)
    expect(data.valuation).toEqual({ no: 2, date: '2026-06-10', status: 'draft', retentionPct: 10 })
    expect(data.projectName).toBe('Kingswalk Mall')
  })

  it('resolves the certifier name via the service client and resolves branding', async () => {
    const { gatherValuationReportData } = await import('./valuation-report-data')
    const data = await gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID)
    expect(data.certifiedByName).toBe('Pat Engineer')
    expect(data.branding.accent).toBe('#0055AA')
    expect(data.branding.title).toMatch(/Payment Certificate No\. 2/)
  })

  it('loads the BOQ tree for the valuation import and the previous net for valuationNo', async () => {
    const { gatherValuationReportData } = await import('./valuation-report-data')
    await gatherValuationReportData(buildCookieMock() as any, PROJECT_ID, VALUATION_ID)
    expect(mockBoqGetTree).toHaveBeenCalledWith(expect.anything(), 'imp-1')
    expect(mockValuationGetPreviousNet).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, 2)
  })
})
