// @vitest-environment node
// Route handlers run in Node; jsdom's Blob has no arrayBuffer().
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: vi.fn(), build: vi.fn(), run: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminAPI: h.gate }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
vi.mock('@esite/shared/tariffs/ingest', () => ({
  buildIngestPlan: h.build, runIngest: h.run, createSupabaseTariffStore: h.store,
  summariseIngestReport: (r: { status: string }) => ({ status: r.status, runId: null, years: [] }),
}))

import { POST } from './route'
import { fakeSupabase } from '@/test/fake-supabase'
import { NextResponse } from 'next/server'

const DOC = { id: 'd1', storage_path: '2026-27/abc.xlsx', sha256: 'a'.repeat(64), url: null, retrieved_at: null }
const req = (body: unknown) => new Request('http://x/api/admin/tariffs/ingest', { method: 'POST', body: JSON.stringify(body) })
const body = { sourceDocumentId: 'd1', parser: 'province_xlsx', financialYear: '2026/27', licenseeName: '', createLicensees: false, apply: false }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})

function admin(tables: Record<string, Array<Record<string, unknown>>> = { 'tariffs.source_document': [DOC] }) {
  const fake = fakeSupabase({ userId: 'a1', tables })
  h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
  h.svc.mockReturnValue({ storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2])]), error: null }) }) } })
  return fake
}

describe('POST /api/admin/tariffs/ingest', () => {
  it('returns the gate response for a non-admin (404) and does nothing', async () => {
    h.gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    const res = await POST(req(body))
    expect(res.status).toBe(404)
    expect(h.build).not.toHaveBeenCalled()
  })
  it('refuses a PDF: those run as a job', async () => {
    admin()
    const res = await POST(req({ ...body, parser: 'rfd_pdf' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'PDF ingests run as a job: use Queue ingest.' })
  })
  it('dry run: the 2a core with apply false, started by the admin', async () => {
    admin()
    h.build.mockResolvedValue({ parser: 'province_xlsx', source: {}, years: [] })
    h.run.mockResolvedValue({ status: 'dry_run', years: [] })
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect(h.build).toHaveBeenCalledWith(expect.objectContaining({ parser: 'province_xlsx', financialYear: '2026/27', sha256: DOC.sha256, fileName: 'abc.xlsx' }))
    expect(h.run).toHaveBeenCalledWith(expect.anything(), undefined, { apply: false, createMissingLicensees: false, startedBy: 'a1' })
    expect(await res.json()).toEqual({ report: { status: 'dry_run', runId: null, years: [] } })
  })
  it('Eskom apply without the Net-Billing Rules PDF is refused', async () => {
    admin()
    const res = await POST(req({ ...body, parser: 'eskom_xlsm', apply: true }))
    expect(res.status).toBe(409)
  })
  it('a malformed body is a 400', async () => {
    admin()
    expect((await POST(req({ ...body, financialYear: '2026-27' }))).status).toBe(400)
  })
})
