// apps/web/src/mcp/define-tool.test.ts
import { vi, it, expect, beforeEach } from 'vitest'
const { rateStatus, recordToolCall, emitProductEvent } = vi.hoisted(() => ({
  rateStatus: vi.fn(), recordToolCall: vi.fn(), emitProductEvent: vi.fn(),
}))
vi.mock('./audit', () => ({ rateStatus, recordToolCall, argsDigest: () => 'd' }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent }))
import { defineTool, ToolRefusal, runTool } from './define-tool'
import { z } from 'zod'
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const O2 = '33333333-3333-4333-8333-333333333333'
// A caller's client that resolves a project's organisation, or fails.
const clientFor = (lookup: () => Promise<{ data: unknown; error: unknown }>) => ({ schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: lookup }) }) }) }) }) as never
const baseCtx = { client: {} as never, user: { id: 'u1' } as never, claims: { client_id: 'c9' }, memberships: [] as { organisationId: string; role: string }[] }
const ctx = baseCtx as never
beforeEach(() => { rateStatus.mockResolvedValue({ calls: 0, writes: 0 }); recordToolCall.mockReset(); emitProductEvent.mockReset() })

it('returns structuredContent and audits ok', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: { projectId: z.string() }, projectIdOf: a => a.projectId, handler: async () => ({ x: 1 }) })
  const r = await runTool(t, { projectId: P1 }, ctx)
  expect(r).toEqual({ content: [{ type: 'text', text: '{"x":1}' }], structuredContent: { x: 1 } })
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'esite_t', kind: 'read', outcome: 'ok', projectId: P1, clientId: 'c9', argsDigest: 'd' }))
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
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error', refusal: null }))
})

const projectTool = () => defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: { projectId: z.string() }, projectIdOf: a => a.projectId, handler: async () => ({ x: 1 }) })
const plainTool = () => defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler: async () => ({ x: 1 }) })

it('stamps the audit row and the event with the project\'s organisation, read through the caller\'s client', async () => {
  const c = { ...baseCtx, client: clientFor(async () => ({ data: { organisation_id: O1 }, error: null })), memberships: [{ organisationId: O2, role: 'owner' }] } as never
  await runTool(projectTool(), { projectId: P1 }, c)
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ projectId: P1, organisationId: O1 }))
  expect(emitProductEvent).toHaveBeenCalledWith(expect.objectContaining({ projectId: P1, organisationId: O1 }))
})
it('uses the only organisation of a single-org caller for a project-less tool and emits the event', async () => {
  const c = { ...baseCtx, memberships: [{ organisationId: O1, role: 'owner' }] } as never
  await runTool(plainTool(), {}, c)
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, organisationId: O1 }))
  expect(emitProductEvent).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, organisationId: O1 }))
})
it('leaves the organisation null for a multi-org caller, skips the event, still audits', async () => {
  const c = { ...baseCtx, memberships: [{ organisationId: O1, role: 'owner' }, { organisationId: O2, role: 'admin' }] } as never
  const r = await runTool(plainTool(), {}, c)
  expect(r.isError).toBeUndefined()
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, organisationId: null }))
  expect(emitProductEvent).not.toHaveBeenCalled()
})
it('treats a failed or empty organisation lookup as null and still succeeds', async () => {
  for (const lookup of [async () => { throw new Error('boom') }, async () => ({ data: null, error: null }), async () => ({ data: null, error: { message: 'x' } })]) {
    recordToolCall.mockReset(); emitProductEvent.mockReset()
    const c = { ...baseCtx, client: clientFor(lookup as never) } as never
    const r = await runTool(projectTool(), { projectId: P1 }, c)
    expect(r.structuredContent).toEqual({ x: 1 })
    expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ projectId: P1, organisationId: null }))
    expect(emitProductEvent).toHaveBeenCalledWith(expect.objectContaining({ projectId: P1, organisationId: null }))
  }
})
it('never passes a non-uuid project id to the audit row or the lookup', async () => {
  const lookup = vi.fn()
  const c = { ...baseCtx, client: clientFor(lookup as never) } as never
  await runTool(projectTool(), { projectId: "x'; drop table" }, c)
  expect(lookup).not.toHaveBeenCalled()
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, organisationId: null }))
})
