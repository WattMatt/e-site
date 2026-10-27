// apps/web/src/mcp/define-tool.test.ts
import { vi, it, expect, beforeEach } from 'vitest'
const { rateStatus, recordToolCall, emitProductEvent } = vi.hoisted(() => ({
  rateStatus: vi.fn(), recordToolCall: vi.fn(), emitProductEvent: vi.fn(),
}))
vi.mock('./audit', () => ({ rateStatus, recordToolCall, argsDigest: () => 'd' }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent }))
import { defineTool, ToolRefusal, runTool } from './define-tool'
import { z } from 'zod'
const ctx = { client: {} as never, user: { id: 'u1' } as never, claims: { client_id: 'c9' }, memberships: [] } as never
beforeEach(() => { rateStatus.mockResolvedValue({ calls: 0, writes: 0 }); recordToolCall.mockReset(); emitProductEvent.mockReset() })

it('returns structuredContent and audits ok', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: { projectId: z.string() }, projectIdOf: a => a.projectId, handler: async () => ({ x: 1 }) })
  const r = await runTool(t, { projectId: 'p1' }, ctx)
  expect(r).toEqual({ content: [{ type: 'text', text: '{"x":1}' }], structuredContent: { x: 1 } })
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'esite_t', kind: 'read', outcome: 'ok', projectId: 'p1', clientId: 'c9', argsDigest: 'd' }))
  expect(emitProductEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'mcp_tool_called', properties: { tool: 'esite_t', kind: 'read', outcome: 'ok' } }))
})
it('turns a ToolRefusal into an isError result with the sentence', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler: async () => { throw new ToolRefusal('Project not found') } })
  expect(await runTool(t, {}, ctx)).toEqual({ isError: true, content: [{ type: 'text', text: 'Project not found' }] })
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'refused', refusal: 'Project not found' }))
})
it('refuses over the rate limit before running the handler', async () => {
  rateStatus.mockResolvedValue({ calls: 120, writes: 0 }); const handler = vi.fn()
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler })
  expect(await runTool(t, {}, ctx)).toEqual({ isError: true, content: [{ type: 'text', text: 'Slow down; try again in a minute.' }] })
  expect(handler).not.toHaveBeenCalled()
})
it('applies the write limit to preview tools', async () => {
  rateStatus.mockResolvedValue({ calls: 5, writes: 20 })
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'preview', inputSchema: {}, handler: async () => ({}) })
  expect((await runTool(t, {}, ctx)).isError).toBe(true)
})
it('hides unexpected errors behind the named sentence', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler: async () => { throw new Error('secret detail') } })
  const r = await runTool(t, {}, ctx)
  expect(r.content[0].text).toBe('Something went wrong on the server; the error was logged.')
  expect(JSON.stringify(r)).not.toContain('secret detail')
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
})
