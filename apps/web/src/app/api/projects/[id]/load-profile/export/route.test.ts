import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state: { user: { id: string } | null; role: string | null } = { user: { id: 'u' }, role: 'contractor' }
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.role, error: null }),
  }),
}))
const loadView = vi.fn(async () => ({ analysis: null }))
vi.mock('@/lib/load-profile/load', () => ({ loadLoadProfileView: (...a: unknown[]) => loadView(...(a as [])) }))
vi.mock('@/lib/load-profile/export-pdf', () => ({ renderLoadProfilePdf: vi.fn() }))
vi.mock('@/lib/load-profile/export-xlsx', () => ({ buildLoadProfileWorkbook: vi.fn() }))

const { GET } = await import('./route')
const P = '11111111-2222-3333-4444-555555555555'
const call = (format = 'xlsx', id = P) => GET(new NextRequest(`http://x/api/projects/${id}/load-profile/export?format=${format}`), { params: Promise.resolve({ id }) })

describe('GET load-profile export — the real requireEffectiveRole gate', () => {
  beforeEach(() => { state.user = { id: 'u' }; state.role = 'contractor'; loadView.mockClear() })

  it('a contractor passes the gate (404: nothing to export yet)', async () => {
    const res = await call()
    expect(res.status).toBe(404)
    expect(loadView).toHaveBeenCalledTimes(1)
  })
  it.each(['client_viewer', null])('role %s is refused before anything is read', async (role) => {
    state.role = role
    const res = await call()
    expect(res.status).toBe(403)
    expect(loadView).not.toHaveBeenCalled()
  })
  it('no session → 401', async () => {
    state.user = null
    expect((await call()).status).toBe(401)
  })
  it('bad format or id → 400', async () => {
    expect((await call('docx')).status).toBe(400)
    expect((await call('pdf', 'nope')).status).toBe(400)
  })
})
