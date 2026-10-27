import { vi, it, expect, beforeEach, afterEach } from 'vitest'
const { getUser, from, hasVerifiedMfaFactor } = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), hasVerifiedMfaFactor: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser }, from }) }))
vi.mock('@/lib/auth/has-verified-mfa-factor', () => ({ hasVerifiedMfaFactor }))
import { authenticateMcpRequest, CONNECT_REFUSAL, AAL_REFUSAL } from './auth'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (claims: object) => `${b64({})}.${b64(claims)}.s`
const req = (auth?: string) => new Request('https://x/api/mcp', { method: 'POST', headers: auth ? { Authorization: auth } : {} })
const rows = (r: { organisation_id: string; role: string }[]) => from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: r, error: null }) }) }) })
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  getUser.mockReset(); from.mockReset(); hasVerifiedMfaFactor.mockResolvedValue(false)
})
afterEach(() => vi.unstubAllEnvs())

it('401 without a bearer', async () => { expect(await authenticateMcpRequest(req())).toMatchObject({ ok: false, status: 401 }) })
it('401 when getUser fails', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1' })}`))).toMatchObject({ ok: false, status: 401 })
})
it('refuses a client_viewer-only user with the connect sentence', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([{ organisation_id: 'o1', role: 'client_viewer' }])
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1', aal: 'aal1' })}`))).toEqual({ ok: false, status: 403, sentence: CONNECT_REFUSAL })
})
it('refuses a user with no org (tender-only)', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([])
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1' })}`))).toMatchObject({ ok: false, sentence: CONNECT_REFUSAL })
})
it('refuses aal1 when a factor is verified', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([{ organisation_id: 'o1', role: 'contractor' }]); hasVerifiedMfaFactor.mockResolvedValue(true)
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1', aal: 'aal1' })}`))).toEqual({ ok: false, status: 403, sentence: AAL_REFUSAL })
})
it('admits a contractor and returns memberships and client_id', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([{ organisation_id: 'o1', role: 'contractor' }, { organisation_id: 'o2', role: 'client_viewer' }])
  const r = await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1', aal: 'aal1', client_id: 'c9' })}`))
  expect(r).toMatchObject({ ok: true, memberships: [{ organisationId: 'o1', role: 'contractor' }, { organisationId: 'o2', role: 'client_viewer' }] })
  expect(r.ok && r.ctx.claims.client_id).toBe('c9')
})
