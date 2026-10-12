// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), gather: vi.fn(), render: vi.fn(), appendix: vi.fn(), project: vi.fn(), service: vi.fn(), upload: vi.fn(), sign: vi.fn(), list: vi.fn(), remove: vi.fn() }))
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

import { GET, maxDuration } from './route'

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
  m.list.mockResolvedValue({ data: [], error: null })
  m.remove.mockResolvedValue({ error: null })
  m.sign.mockResolvedValue({ data: { signedUrl: 'https://ref.supabase.co/storage/v1/object/sign/reports/x?token=t' }, error: null })
  m.service.mockReturnValue({ storage: { from: () => ({ upload: m.upload, createSignedUrl: m.sign, list: m.list, remove: m.remove }) } })
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
  it('hands the PDF over through storage: per-user, per-request preview path, 303 to a 10-minute signed URL, never in the body', async () => {
    const res = await call()
    const path = m.upload.mock.calls[0]![0] as string
    expect(path).toMatch(new RegExp(`^org-1/${PID}/previews/u1/tenant-schedule-[0-9a-f]{8,}\\.pdf$`))
    expect(m.upload.mock.calls[0]![2]).toMatchObject({ contentType: 'application/pdf', upsert: true })
    expect(m.sign).toHaveBeenCalledWith(path, 600, undefined)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://ref.supabase.co/storage/v1/object/sign/reports/x?token=t')
  })
  it('two requests never share an object name', async () => {
    await call(); await call()
    expect(m.upload.mock.calls[0]![0]).not.toBe(m.upload.mock.calls[1]![0])
  })
  it('prunes this user\'s older previews, keeping the newest 3, and a pruning failure does not fail the preview', async () => {
    m.list.mockResolvedValue({ data: ['e', 'd', 'c', 'b', 'a'].map((n) => ({ name: `tenant-schedule-${n}.pdf` })), error: null })
    expect((await call()).status).toBe(303)
    expect(m.list).toHaveBeenCalledWith(`org-1/${PID}/previews/u1`, expect.anything())
    expect(m.remove).toHaveBeenCalledWith([`org-1/${PID}/previews/u1/tenant-schedule-b.pdf`, `org-1/${PID}/previews/u1/tenant-schedule-a.pdf`])
    m.list.mockRejectedValue(new Error('down'))
    expect((await call()).status).toBe(303)
  })
  it('allows 120 s for the render', () => { expect(maxDuration).toBe(120) })
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
