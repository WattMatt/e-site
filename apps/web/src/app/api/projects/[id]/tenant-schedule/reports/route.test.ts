// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), gather: vi.fn(), render: vi.fn(), appendix: vi.fn(), service: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }), createServiceClient: m.service }))
vi.mock('@/lib/reports/tenant-schedule-report-data', () => ({ gatherTenantScheduleReportData: m.gather }))
vi.mock('@/lib/reports/render-tenant-schedule', () => ({ renderTenantScheduleReport: m.render }))
vi.mock('@/lib/reports/branding', () => ({ resolveBranding: () => ({ issuer: {} }) }))
vi.mock('@/lib/reports/tenant-schedule-report-branding', () => ({ buildTenantScheduleBrandingInput: () => ({}) }))
vi.mock('@/lib/status-plans/report-appendix', () => ({ loadReportAppendix: m.appendix }))

import { POST } from './route'

const PID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const post = (q = '') => POST(new NextRequest(`http://localhost/api/projects/${PID}/tenant-schedule/reports${q}`, { method: 'POST' }), { params: Promise.resolve({ id: PID }) })

/** A service client that records the reports insert. */
function fakeService() {
  const inserted: Array<Record<string, unknown>> = []
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'neq', 'order', 'limit', 'update']) q[k] = () => q
    q.maybeSingle = async () => result
    q.single = async () => result
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
    return q
  }
  const svc = {
    schema: () => ({
      from: (t: string) => {
        if (t === 'projects') return chain({ data: { organisation_id: 'org1' } })
        return {
          ...chain({ data: null }),
          insert: (row: Record<string, unknown>) => { inserted.push(row); return chain({ data: { id: 'r1', version: 1 }, error: null }) },
        }
      },
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  }
  return { svc, inserted }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  m.gather.mockResolvedValue({})
  m.render.mockResolvedValue(Buffer.from('%PDF-1.7'))
  m.service.mockImplementation(() => { throw new Error('service client must not be reached in this test') })
})

describe('POST reports — status plan appendix', () => {
  it('a refused appendix gate stops before any render or write', async () => {
    m.appendix.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    const res = await post('?tenantPlans=1')
    expect(res.status).toBe(404)
    expect(m.render).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('renders with the appendix and records what the saved version holds', async () => {
    const appendix = { load: { inputs: [{}, {}], omitted: [{ title: 't', reason: 'r' }] }, generatedOn: '2026-10-09' }
    m.appendix.mockResolvedValue({ ok: true, appendix })
    const { svc, inserted } = fakeService()
    m.service.mockReturnValue(svc)
    const res = await post('?tenantPlans=1&schematicPlans=1')
    expect(res.status).toBe(201)
    expect(m.appendix.mock.calls[0]![0].url).toContain('schematicPlans=1')
    expect(m.render.mock.calls[0]![2]).toBe(appendix)
    expect(inserted[0]!.summary).toEqual({ statusPlans: 2, statusPlansNotIncluded: 1 })
  })
  it('no appendix → summary stays null', async () => {
    m.appendix.mockResolvedValue({ ok: true, appendix: null })
    const { svc, inserted } = fakeService()
    m.service.mockReturnValue(svc)
    expect((await post()).status).toBe(201)
    expect(inserted[0]!.summary).toBeNull()
  })
})
