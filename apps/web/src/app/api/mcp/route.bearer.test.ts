import { vi, it, expect, beforeEach } from 'vitest'
// The bearer context must reach createClient() inside a tool handler dispatched by the SDK.
// Neither @/lib/supabase/server nor the AsyncLocalStorage is mocked: only the supabase-js factory and cookies are.
const { authenticateMcpRequest, cookies, createSupabaseClient, observed } = vi.hoisted(() => ({
  authenticateMcpRequest: vi.fn(),
  cookies: vi.fn(),
  createSupabaseClient: vi.fn(() => ({ tag: 'bearer-client' })),
  observed: { headers: [] as unknown[] },
}))
vi.mock('@/mcp/auth', () => ({ authenticateMcpRequest }))
vi.mock('next/headers', () => ({ cookies }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createSupabaseClient }))
vi.mock('@/mcp/audit', () => ({ rateStatus: async () => ({ calls: 0, writes: 0 }), recordToolCall: async () => {}, argsDigest: () => 'd' }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: async () => {} }))
vi.mock('@/mcp/tools', async () => {
  const { defineTool } = await import('@/mcp/define-tool')
  const { createClient } = await import('@/lib/supabase/server')
  const probe = defineTool({
    name: 'esite_probe', title: 'p', description: 'p', kind: 'read', inputSchema: {},
    handler: async () => {
      createSupabaseClient.mockClear() // drop the route's own client, so only this handler's call is counted
      await createClient()
      observed.headers = createSupabaseClient.mock.calls.map((c) => (c as unknown as [string, string, { global: { headers: unknown } }])[2].global.headers)
      return { ok: true }
    },
  })
  return { ALL_TOOLS: [probe] }
})
import { POST } from './route'

const call = (token: string) => new Request('https://www.e-site.live/api/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'esite_probe', arguments: {} } }),
})
const as = (token: string, id: string) =>
  authenticateMcpRequest.mockResolvedValue({ ok: true, ctx: { accessToken: token, user: { id }, claims: {} }, memberships: [] })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MCP_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
})

it('binds each request\'s own bearer to createClient() inside a dispatched tool handler, never touching cookies', async () => {
  as('token-A', 'user-a')
  const a = await POST(call('token-A'))
  expect((await a.json()).result.structuredContent).toEqual({ ok: true })
  expect(observed.headers).toEqual([{ Authorization: 'Bearer token-A' }])

  as('token-B', 'user-b')
  const b = await POST(call('token-B'))
  expect((await b.json()).result.structuredContent).toEqual({ ok: true })
  expect(observed.headers).toEqual([{ Authorization: 'Bearer token-B' }])

  expect(cookies).not.toHaveBeenCalled()
})
