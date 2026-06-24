// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderTenantScheduleReport } from './render-tenant-schedule'
import { resolveBranding } from './branding'
import { buildTenantScheduleBrandingInput } from './tenant-schedule-report-branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'

const baseData: TenantScheduleReportData = {
  projectName: 'Princess Mkabayi, Vryheid',
  kpis: {
    totalShops: 4, activeShops: 3, decommissionedShops: 1, totalGlaM2: 2040,
    scopeReceivedPct: 67, layoutsIssuedPct: 67,
    boards: { landlord: 2, ordered: 1 }, lights: { landlord: 1, ordered: 1 },
    byTenantCount: 2, bo: { upcoming: 1, overdue: 1, noDate: 1 },
  },
  shopRows: [
    { shopNumber: 'L01', tenantName: 'Woolworths', glaM2: 1240, breakerA: 63, poleConfig: 'TP', loadA: 60, db: 'ordered', lights: 'received', layoutIssued: true, boDate: '2026-08-15', boOverdue: false },
    { shopNumber: 'L02', tenantName: 'Mr Price', glaM2: 480, breakerA: null, poleConfig: null, loadA: null, db: 'by_tenant', lights: 'by_tenant', layoutIssued: true, boDate: '2026-05-01', boOverdue: true },
  ],
  brandingInput: {
    orgName: 'Watson Mattheus', orgLogoDataUri: null, orgAccent: null, projectAccent: null,
    clientLogoDataUri: null, projectMarkDataUri: null, projectSubtitle: 'Tenant coordination',
  },
}

function render(data: TenantScheduleReportData) {
  return renderTenantScheduleReport(data, resolveBranding(buildTenantScheduleBrandingInput(data, '2026-06-20')))
}

describe('renderTenantScheduleReport', () => {
  it('returns a Buffer starting with the PDF magic bytes', async () => {
    const buf = await render(baseData)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders with no shops and with missing GLA / BO dates', async () => {
    const empty = { ...baseData, kpis: { ...baseData.kpis, activeShops: 0, totalShops: 1 }, shopRows: [] }
    expect((await render(empty)).slice(0, 5).toString('ascii')).toBe('%PDF-')
    const sparse = {
      ...baseData,
      shopRows: [{ shopNumber: 'X1', tenantName: 'Vacant', glaM2: null, breakerA: null, poleConfig: null, loadA: null, db: null, lights: null, layoutIssued: false, boDate: null, boOverdue: false }],
    }
    expect((await render(sparse)).slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
