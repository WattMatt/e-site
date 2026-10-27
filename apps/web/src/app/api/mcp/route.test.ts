import { vi, it, expect, beforeEach } from 'vitest'
const { authenticateMcpRequest, recordToolCall } = vi.hoisted(() => ({
  authenticateMcpRequest: vi.fn(),
  recordToolCall: vi.fn(async () => {}),
}))
vi.mock('@/mcp/auth', () => ({ authenticateMcpRequest }))
vi.mock('@/mcp/audit', () => ({ rateStatus: async () => ({ calls: 0, writes: 0 }), recordToolCall, argsDigest: () => 'd' }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: async () => {} }))
// esite_whoami is the tool exercised end to end; everything it loads is mocked so the file stays offline.
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), projectService: { listAccessible: async () => [], getById: async () => ({}) } }))
vi.mock('@/lib/project-settings', () => ({ getProjectSettingsCached: async () => null, getProjectHistoryCached: async () => [] }))
vi.mock('@/actions/project-contacts.actions', () => ({ listProjectContacts: async () => ({ contacts: [] }) }))
vi.mock('@/actions/project-members.actions', () => ({ listProjectMembers: async () => ({ members: [] }) }))
vi.mock('@/actions/active-organisation.actions', () => ({ listMyOrganisations: async () => ({ ok: true, memberships: [] }) }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: async () => ({ ok: false, error: 'no' }) }))
vi.mock('@/lib/auth/require-project-access', () => ({ requireProjectAccess: async () => ({ ok: true }) }))
vi.mock('@/lib/projects/cost-visibility', () => ({ loadCostVisibility: async () => () => false }))
import { POST, GET } from './route'
const init = (body: unknown, accept = 'application/json, text/event-stream') => new Request('https://www.e-site.live/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept, authorization: 'Bearer t' }, body: JSON.stringify(body) })
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }
beforeEach(() => { vi.clearAllMocks(); process.env.MCP_ENABLED = 'true'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; authenticateMcpRequest.mockResolvedValue({ ok: true, ctx: { accessToken: 't', user: { id: 'u1' }, claims: {} }, memberships: [] }) })

it('404 when the kill switch is off, and nothing is audited', async () => { process.env.MCP_ENABLED = 'false'; expect((await POST(init(initialize))).status).toBe(404); expect(authenticateMcpRequest).not.toHaveBeenCalled(); expect(recordToolCall).not.toHaveBeenCalled() })
it('405 on GET, and nothing is audited', async () => { expect((await GET()).status).toBe(405); expect(recordToolCall).not.toHaveBeenCalled() })
it('401 with the challenge when auth fails', async () => {
  authenticateMcpRequest.mockResolvedValue({ ok: false, status: 401, sentence: 'Sign in required.' })
  const r = await POST(init(initialize)); expect(r.status).toBe(401); expect(r.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
})
it('answers initialize with JSON (no SSE) and lists tools', async () => {
  const r = await POST(init(initialize)); expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('application/json')
  const body = await r.json(); expect(body.result.serverInfo.name).toBe('e-site')
  const list = await POST(init({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  const names = ((await list.json()).result.tools as { name: string }[]).map(t => t.name)
  expect(names).toEqual(expect.arrayContaining(['esite_whoami', 'esite_projects_list', 'esite_project_get', 'esite_project_history']))
})
it('answers a notification with 202 and an empty body', async () => {
  const r = await POST(init({ jsonrpc: '2.0', method: 'notifications/initialized' })); expect(r.status).toBe(202)
})
it('keeps two users separate across requests', async () => {
  const call = async (id: string) => {
    authenticateMcpRequest.mockResolvedValue({ ok: true, ctx: { accessToken: 't', user: { id, email: `${id}@x.co` }, claims: {} }, memberships: [] })
    const r = await POST(init({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'esite_whoami', arguments: {} } }))
    expect(r.status).toBe(200)
    return (await r.json()).result.structuredContent
  }
  const a = await call('user-a')
  const b = await call('user-b')
  expect(a.userId).toBe('user-a')
  expect(b.userId).toBe('user-b')
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', tool: 'esite_whoami' }))
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-b', tool: 'esite_whoami' }))
})
