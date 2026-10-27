import { vi, it, expect, beforeEach } from 'vitest'
const { authenticateMcpRequest, recordToolCall } = vi.hoisted(() => ({
  authenticateMcpRequest: vi.fn(),
  recordToolCall: vi.fn(async () => {}),
}))
vi.mock('@/mcp/auth', () => ({ authenticateMcpRequest }))
vi.mock('@/mcp/audit', () => ({ rateStatus: async () => ({ calls: 0, writes: 0 }), recordToolCall, argsDigest: () => 'd' }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: async () => {} }))
vi.mock('@/mcp/tools', async () => {
  const { z } = await import('zod')
  const { defineTool } = await import('@/mcp/define-tool')
  return { ALL_TOOLS: [defineTool({ name: 'stub', title: 'Stub', description: 'Stub', kind: 'read', inputSchema: { a: z.string().optional() }, handler: async () => ({}) })] }
})
import { POST, GET } from './route'
const init = (body: unknown, accept = 'application/json, text/event-stream') => new Request('https://www.e-site.live/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept, authorization: 'Bearer t' }, body: JSON.stringify(body) })
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }
beforeEach(() => { process.env.MCP_ENABLED = 'true'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; authenticateMcpRequest.mockResolvedValue({ ok: true, ctx: { accessToken: 't', user: { id: 'u1' }, claims: {} }, memberships: [] }) })

it('404 when the kill switch is off, and nothing is audited', async () => { process.env.MCP_ENABLED = 'false'; expect((await POST(init(initialize))).status).toBe(404); expect(recordToolCall).not.toHaveBeenCalled() })
it('405 on GET, and nothing is audited', async () => { expect((await GET()).status).toBe(405); expect(recordToolCall).not.toHaveBeenCalled() })
it('401 with the challenge when auth fails', async () => {
  authenticateMcpRequest.mockResolvedValue({ ok: false, status: 401, sentence: 'Sign in required.' })
  const r = await POST(init(initialize)); expect(r.status).toBe(401); expect(r.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
})
it('answers initialize with JSON (no SSE) and lists tools', async () => {
  const r = await POST(init(initialize)); expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('application/json')
  const body = await r.json(); expect(body.result.serverInfo.name).toBe('e-site')
  const list = await POST(init({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  // Task 8 registers the real tools; until then ./tools is stubbed (below), because the SDK
  // advertises no tools/list handler at all when nothing is registered.
  expect(Array.isArray((await list.json()).result.tools)).toBe(true)
})
it('answers a notification with 202 and an empty body', async () => {
  const r = await POST(init({ jsonrpc: '2.0', method: 'notifications/initialized' })); expect(r.status).toBe(202)
})
