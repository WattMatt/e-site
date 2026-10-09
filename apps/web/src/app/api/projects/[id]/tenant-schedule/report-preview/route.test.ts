// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), gather: vi.fn(), render: vi.fn(), appendix: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }) }))
vi.mock('@/lib/reports/tenant-schedule-report-data', () => ({ gatherTenantScheduleReportData: m.gather }))
vi.mock('@/lib/reports/render-tenant-schedule', () => ({ renderTenantScheduleReport: m.render }))
vi.mock('@/lib/reports/branding', () => ({ resolveBranding: () => ({}) }))
vi.mock('@/lib/reports/tenant-schedule-report-branding', () => ({ buildTenantScheduleBrandingInput: () => ({}) }))
vi.mock('@/lib/status-plans/report-appendix', () => ({ loadReportAppendix: m.appendix }))

import { GET } from './route'

const PID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const call = (q = '') => GET(new NextRequest(`http://localhost/api/projects/${PID}/tenant-schedule/report-preview${q}`), { params: Promise.resolve({ id: PID }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  m.gather.mockResolvedValue({})
  m.render.mockResolvedValue(Buffer.from('%PDF-1.7'))
  m.appendix.mockResolvedValue({ ok: true, appendix: null })
})

describe('GET report-preview — status plan appendix', () => {
  it('passes the request URL to the appendix helper and its result to the renderer', async () => {
    const appendix = { load: { inputs: [], omitted: [] }, generatedOn: '2026-10-09' }
    m.appendix.mockResolvedValue({ ok: true, appendix })
    const res = await call('?tenantPlans=1')
    expect(res.status).toBe(200)
    expect(m.appendix.mock.calls[0]![0]).toMatchObject({ url: expect.stringContaining('tenantPlans=1'), projectId: PID })
    expect(m.appendix.mock.calls[0]![0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(m.render.mock.calls[0]![2]).toBe(appendix)
  })
  it('a refused gate is a 404 and nothing renders', async () => {
    m.appendix.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    const res = await call('?tenantPlans=1')
    expect(res.status).toBe(404)
    expect(m.render).not.toHaveBeenCalled()
  })
  it('signed out → 401 before any helper runs', async () => {
    m.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call()).status).toBe(401)
    expect(m.appendix).not.toHaveBeenCalled()
  })
})
