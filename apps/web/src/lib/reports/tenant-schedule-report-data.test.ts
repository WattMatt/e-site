// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeTablesClient } from '@/lib/tenant-schedule/__fixtures__/fake-tables-client'
import { PROBE_TABLES } from '@/lib/tenant-schedule/__fixtures__/probe-mall'

const h = vi.hoisted(() => ({
  client: null as unknown,
  project: { id: 'p-1', name: 'Probe Mall', organisation_id: 'org-1', opening_date: '2026-09-01' },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
  createServiceClient: vi.fn(() => h.client),
}))

vi.mock('@esite/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@esite/shared')>()
  return { ...actual, projectService: { ...actual.projectService, getById: vi.fn(async () => h.project) } }
})

import { gatherTenantScheduleReportData } from './tenant-schedule-report-data'

describe('gatherTenantScheduleReportData (characterisation)', () => {
  beforeEach(() => {
    h.client = fakeTablesClient(PROBE_TABLES).client
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-20T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the same report data the PDF renders', async () => {
    const data = await gatherTenantScheduleReportData('p-1')
    expect(data).toEqual({
      projectName: 'Probe Mall',
      kpis: {
        totalShops: 3,
        activeShops: 2,
        decommissionedShops: 1,
        totalGlaM2: 200,
        scopeComplete: 2,
        scopeCompletePct: 100,
        layoutsIssued: 1,
        layoutsIssuedPct: 50,
        boards: { landlord: 2, ordered: 2 },
        lights: { landlord: 0, ordered: 0 },
        byTenantCount: 1,
        bo: { upcoming: 1, overdue: 1, noDate: 0 },
      },
      shopRows: [
        {
          shopNumber: 'ZZ01', tenantName: 'Lantern Books', glaM2: 120, breakerA: 63, poleConfig: 'TP', loadA: 48,
          db: 'received', lights: 'by_tenant', scope: 'received', layoutIssued: true, boDate: '2026-08-02', boOverdue: false,
        },
        {
          shopNumber: 'ZZ02', tenantName: 'Copper Kettle', glaM2: 80, breakerA: 40, poleConfig: 'SP', loadA: null,
          db: 'ordered', lights: null, scope: 'not_required', layoutIssued: false, boDate: '2026-06-01', boOverdue: true,
        },
      ],
      brandingInput: {
        orgName: 'Probe Org',
        orgLogoDataUri: null,
        orgAccent: null,
        projectAccent: '#123456',
        clientLogoDataUri: null,
        projectMarkDataUri: null,
        projectSubtitle: 'Tenant coordination',
      },
    })
  })

  it('refuses a project the caller cannot see', async () => {
    const shared = await import('@esite/shared')
    vi.mocked(shared.projectService.getById).mockResolvedValueOnce(null as never)
    await expect(gatherTenantScheduleReportData('p-1')).rejects.toThrow('Project not found')
  })
})
