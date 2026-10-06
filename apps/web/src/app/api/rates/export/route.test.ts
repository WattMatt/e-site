import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ requireRoleAPI: vi.fn(), createClient: vi.fn(), loadLibrary: vi.fn(), logRateAccess: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireRoleAPI: h.requireRoleAPI }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/rate-library/data', () => ({ loadLibrary: h.loadLibrary, logRateAccess: h.logRateAccess }))

import { GET } from './route'

const stats = (median: number, p75: number) => ({ n: 2, min: 1, median, p75, max: 9, latest: { rate: 9, pricedOn: '2026-06-25' } })
beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({})
  h.loadLibrary.mockResolvedValue({
    cpiLatest: '2026-08',
    facets: { provinces: [], contractors: [], categories: [] },
    summaries: [{ item: { code: 'CONDUIT-20-PVC-M', description: 'Conduit, PVC, 20 mm dia', unit: 'm' }, nominal: stats(9.5, 9.8), escalated: stats(9.65, 9.95), contractors: 2, provinces: [], earliest: '2026-06-09' }],
  })
})

describe('GET /api/rates/export', () => {
  it('returns the gate response for a role outside COST_VIEW_ROLES and reads nothing', async () => {
    h.requireRoleAPI.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) })
    const res = await GET(new NextRequest('https://x.test/api/rates/export'))
    expect(res.status).toBe(403)
    expect(h.loadLibrary).not.toHaveBeenCalled()
    expect(h.logRateAccess).not.toHaveBeenCalled()
  })

  it('exports the chosen statistic, escalated, and logs the export', async () => {
    h.requireRoleAPI.mockResolvedValue({ ok: true, ctx: { organisationId: 'org-1', role: 'project_manager', userId: 'u' }, user: {} })
    const res = await GET(new NextRequest('https://x.test/api/rates/export?stat=p75&province=Gauteng&from=bad'))
    const body = await res.text()
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(body).toContain('CONDUIT-20-PVC-M,"Conduit, PVC, 20 mm dia",m,p75,9.95,9.80,2,2026-06-09,2026-06-25,2026-08')
    expect(h.loadLibrary).toHaveBeenCalledWith({}, 'org-1', expect.objectContaining({ province: 'Gauteng', from: undefined }))
    expect(h.logRateAccess).toHaveBeenCalledWith({}, 'org-1', 'export_budget', null, expect.objectContaining({ statistic: 'p75' }))
  })

  it('refuses an unknown statistic', async () => {
    h.requireRoleAPI.mockResolvedValue({ ok: true, ctx: { organisationId: 'org-1', role: 'owner', userId: 'u' }, user: {} })
    const res = await GET(new NextRequest('https://x.test/api/rates/export?stat=mean'))
    expect(res.status).toBe(400)
  })
})
