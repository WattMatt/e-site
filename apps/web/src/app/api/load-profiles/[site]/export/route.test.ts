// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state: { user: { id: string } | null; role: string | null } = { user: { id: 'u' }, role: 'contractor' }
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/auth-org', () => ({
  getOrgContext: async () => (state.role ? { userId: 'u', organisationId: 'o', role: state.role } : null),
}))
const loadView = vi.fn(async (..._a: unknown[]) => ({ analysis: null }))
vi.mock('@/lib/load-profile/archive', async (orig) => ({ ...(await orig<object>()), loadArchiveSiteView: (...a: unknown[]) => loadView(...a) }))
vi.mock('@/lib/load-profile/export-pdf', () => ({ renderLoadProfilePdf: vi.fn() }))
vi.mock('@/lib/load-profile/export-xlsx', () => ({ buildLoadProfileWorkbook: vi.fn() }))

const { GET } = await import('./route')
const call = (format = 'xlsx', site = 'PARK%20CENTRAL', q = '') => GET(new NextRequest(`http://x/api/load-profiles/${site}/export?format=${format}${q}`), { params: Promise.resolve({ site }) })

describe('GET /api/load-profiles/[site]/export — the real requireRoleAPI gate', () => {
  beforeEach(() => { state.user = { id: 'u' }; state.role = 'contractor'; loadView.mockClear() })

  it('a contractor passes the gate (404: no profile to export)', async () => {
    expect((await call()).status).toBe(404)
    expect(loadView).toHaveBeenCalledTimes(1)
  })
  it('decodes the site and parses the settings', async () => {
    await call('pdf', 'PARK%20CENTRAL', '&year=2024&pf=0.9')
    expect(loadView.mock.calls[0].slice(1)).toEqual(['PARK CENTRAL', { referenceYear: 2024, powerFactor: 0.9, includeHourly: false }])
  })
  it.each(['client_viewer', 'supplier'])('role %s is refused before anything is read', async (role) => {
    state.role = role
    expect((await call()).status).toBe(403)
    expect(loadView).not.toHaveBeenCalled()
  })
  it('no session → 401; bad format → 400', async () => {
    expect((await call('docx')).status).toBe(400)
    state.user = null
    expect((await call()).status).toBe(401)
    expect(loadView).not.toHaveBeenCalled()
  })
})
