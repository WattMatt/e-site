// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), gather: vi.fn(), render: vi.fn(), appendix: vi.fn(), project: vi.fn(), service: vi.fn(), upload: vi.fn(), sign: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: m.getUser },
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.project }) }) }) }),
  }),
  createServiceClient: m.service,
}))
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
  m.project.mockResolvedValue({ data: { organisation_id: 'org-1' }, error: null })
  m.upload.mockResolvedValue({ error: null })
  m.sign.mockResolvedValue({ data: { signedUrl: 'https://ref.supabase.co/storage/v1/object/sign/reports/x?token=t' }, error: null })
  m.service.mockReturnValue({ storage: { from: () => ({ upload: m.upload, createSignedUrl: m.sign }) } })
})

describe('GET report-preview — status plan appendix', () => {
  it('passes the request URL to the appendix helper and its result to the renderer', async () => {
    const appendix = { load: { inputs: [], omitted: [] }, generatedOn: '2026-10-09' }
    m.appendix.mockResolvedValue({ ok: true, appendix })
    const res = await call('?tenantPlans=1')
    expect(res.status).toBe(303)
    expect(m.appendix.mock.calls[0]![0]).toMatchObject({ url: expect.stringContaining('tenantPlans=1'), projectId: PID })
    expect(m.appendix.mock.calls[0]![0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(m.render.mock.calls[0]![2]).toBe(appendix)
  })
  it('a refused gate is a 404 and nothing renders', async () => {
    m.appendix.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    const res = await call('?tenantPlans=1')
    expect(res.status).toBe(404)
    expect(m.render).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('hands the PDF over through storage: per-user preview path, 303 to a 10-minute signed URL, never in the body', async () => {
    const res = await call()
    expect(m.upload).toHaveBeenCalledWith(`org-1/${PID}/previews/u1/tenant-schedule.pdf`, expect.any(ArrayBuffer), expect.objectContaining({ contentType: 'application/pdf', upsert: true }))
    expect(m.sign).toHaveBeenCalledWith(`org-1/${PID}/previews/u1/tenant-schedule.pdf`, 600, undefined)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://ref.supabase.co/storage/v1/object/sign/reports/x?token=t')
  })
  it('a project the caller cannot read → 404 and nothing is stored', async () => {
    m.project.mockResolvedValue({ data: null, error: null })
    expect((await call()).status).toBe(404)
    expect(m.service).not.toHaveBeenCalled()
  })
  it('signed out → 401 before any helper runs', async () => {
    m.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call()).status).toBe(401)
    expect(m.appendix).not.toHaveBeenCalled()
  })
})
