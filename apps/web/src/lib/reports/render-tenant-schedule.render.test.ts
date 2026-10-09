// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderTenantScheduleReport } from './render-tenant-schedule'
import { resolveBranding } from './branding'
import { buildTenantScheduleBrandingInput } from './tenant-schedule-report-branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import { PDFDocument, rgb } from 'pdf-lib'
import { TENANT_LEGEND } from '@esite/shared/status-plans'
import { extractPdfText, squash } from '@/test/pdf-text'

const baseData: TenantScheduleReportData = {
  projectName: 'Princess Mkabayi, Vryheid',
  kpis: {
    totalShops: 4, activeShops: 3, decommissionedShops: 1, totalGlaM2: 2040,
    scopeComplete: 2, scopeCompletePct: 67, layoutsIssued: 2, layoutsIssuedPct: 67,
    boards: { landlord: 2, ordered: 1 }, lights: { landlord: 1, ordered: 1 },
    byTenantCount: 2, bo: { upcoming: 1, overdue: 1, noDate: 1 },
  },
  shopRows: [
    { shopNumber: 'L01', tenantName: 'Woolworths', glaM2: 1240, breakerA: 63, poleConfig: 'TP', loadA: 60, db: 'ordered', lights: 'received', scope: 'received', layoutIssued: true, boDate: '2026-08-15', boOverdue: false },
    { shopNumber: 'L02', tenantName: 'Mr Price', glaM2: 480, breakerA: null, poleConfig: null, loadA: null, db: 'by_tenant', lights: 'by_tenant', scope: 'not_required', layoutIssued: true, boDate: '2026-05-01', boOverdue: true },
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
      shopRows: [{ shopNumber: 'X1', tenantName: 'Vacant', glaM2: null, breakerA: null, poleConfig: null, loadA: null, db: null, lights: null, scope: 'awaited' as const, layoutIssued: false, boDate: null, boOverdue: false }],
    }
    expect((await render(sparse)).slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})

async function pages(buf: Uint8Array) { return (await PDFDocument.load(buf)).getPageCount() }
async function drawingPdf() {
  const d = await PDFDocument.create()
  d.addPage([600, 400]).drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(0, 0, 1) })
  return d.save()
}
const planInput = (bytes: Uint8Array) => ({
  planId: 'a', planName: 'Ground floor tenants', purpose: 'tenant_layout' as const, drawingName: 'Tenant layout', pageIndex: 1,
  generatedOn: '2026-06-20', source: { kind: 'pdf' as const, bytes, pageIndex: 1 }, shapes: [], legend: TENANT_LEGEND,
  counts: {}, measured: null, warnings: [],
})

describe('renderTenantScheduleReport — status plan appendix', () => {
  function renderWith(appendix: Parameters<typeof renderTenantScheduleReport>[2]) {
    return renderTenantScheduleReport(baseData, resolveBranding(buildTenantScheduleBrandingInput(baseData, '2026-06-20')), appendix)
  }
  it('no appendix → the same page count as before', async () => {
    expect(await pages(await renderWith(null))).toBe(await pages(await render(baseData)))
  })
  it('appends a divider and one page per plan', async () => {
    const base = await pages(await render(baseData))
    const out = await renderWith({ load: { inputs: [planInput(await drawingPdf())], omitted: [] }, generatedOn: '2026-06-20' })
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(await pages(out)).toBe(base + 2)
    expect(squash(extractPdfText(out))).toContain('Appendix—Tenantstatusplans')
  })
  it('an unreadable drawing still ships the report, listed on the divider', async () => {
    const base = await pages(await render(baseData))
    const out = await renderWith({ load: { inputs: [planInput(new TextEncoder().encode('nope'))], omitted: [] }, generatedOn: '2026-06-20' })
    expect(await pages(out)).toBe(base + 1)
    expect(squash(extractPdfText(out))).toContain('thedrawingPDFcouldnotberead')
  })
})
