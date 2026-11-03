import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext } from '../../define-tool'
import { argsDigest } from '../../audit'
import { PREVIEW_MISMATCH } from './sentences'
import { createPreview, consumePreview, type PreviewArgs } from './previews'

const NOW = new Date('2026-11-03T10:00:00.000Z')
const HOUR = 3_600_000
const PID = '99999999-9999-4999-8999-999999999999'
const args: PreviewArgs = { schema: 'projects', table: 'rfis', filters: [{ column: 'status', op: 'eq', value: 'open' }], patch: { status: 'closed' } }

function setup() {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [] } as unknown as ToolContext
  return { ...f, ctx }
}
const stored = (over: Record<string, unknown> = {}) => ({
  id: PID, tool: 'esite_db_update', args_digest: argsDigest(args), matched_ids: ['a', 'b'], would_affect: 2,
  created_at: new Date(NOW.getTime() - HOUR).toISOString(), consumed_at: null, ...over,
})

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('createPreview', () => {
  it('deletes rows older than 7 days first, then inserts the digest and returns expiresAt 24 h after created_at', async () => {
    const { ctx, calls, respond } = setup()
    respond({ data: [] })
    respond({ data: { id: PID, created_at: '2026-11-03T10:00:00.123+00:00' } })
    const out = await createPreview(ctx, { tool: 'esite_db_update', args, matchedIds: ['a', 'b'], wouldAffect: 2 })
    expect(calls.map(c => [c.path, c.method, c.args])).toEqual([
      ['public.mcp_previews', 'delete', []],
      ['public.mcp_previews', 'lt', ['created_at', new Date(NOW.getTime() - 7 * 24 * HOUR).toISOString()]],
      ['public.mcp_previews', 'insert', [{ tool: 'esite_db_update', args_digest: argsDigest(args), matched_ids: ['a', 'b'], would_affect: 2 }]],
      ['public.mcp_previews', 'select', ['id, created_at']],
      ['public.mcp_previews', 'single', []],
    ])
    expect(out).toEqual({ previewId: PID, expiresAt: '2026-11-04T10:00:00.123Z' })
  })

  it('ignores an error from the cleanup delete and still inserts', async () => {
    const { ctx, calls, respond } = setup()
    respond({ data: null, error: { code: '42501', message: 'nope' } })
    respond({ data: { id: PID, created_at: NOW.toISOString() } })
    await expect(createPreview(ctx, { tool: 'esite_db_delete', args, matchedIds: null, wouldAffect: 3 })).resolves.toMatchObject({ previewId: PID })
    expect(calls.find(c => c.method === 'insert')?.args).toEqual([{ tool: 'esite_db_delete', args_digest: argsDigest(args), matched_ids: null, would_affect: 3 }])
  })

  it('surfaces an insert error as a database refusal', async () => {
    const { ctx, respond } = setup()
    respond({ data: [] })
    respond({ data: null, error: { code: '42501', message: 'permission denied for table mcp_previews' } })
    await expect(createPreview(ctx, { tool: 'esite_db_update', args, matchedIds: [], wouldAffect: 0 })).rejects.toThrow('Database error 42501: permission denied for table mcp_previews')
  })
})

describe('consumePreview', () => {
  const input = { previewId: PID, tool: 'esite_db_update', args }

  it('happy path: reads the row, consumes it with consumed_at only, returns the stored set', async () => {
    const { ctx, calls, respond } = setup()
    respond({ data: stored() })
    respond({ data: [{ id: PID }] })
    const out = await consumePreview(ctx, input)
    expect(out).toEqual({ matchedIds: ['a', 'b'], wouldAffect: 2 })
    expect(calls.map(c => [c.path, c.method, c.args])).toEqual([
      ['public.mcp_previews', 'select', ['*']],
      ['public.mcp_previews', 'eq', ['id', PID]],
      ['public.mcp_previews', 'maybeSingle', []],
      ['public.mcp_previews', 'update', [{ consumed_at: NOW.toISOString() }]],
      ['public.mcp_previews', 'eq', ['id', PID]],
      ['public.mcp_previews', 'is', ['consumed_at', null]],
      ['public.mcp_previews', 'select', ['id']],
    ])
  })

  it('a count-only preview comes back with matchedIds null', async () => {
    const { ctx, respond } = setup()
    respond({ data: stored({ matched_ids: null, would_affect: 7 }) })
    respond({ data: [{ id: PID }] })
    await expect(consumePreview(ctx, input)).resolves.toEqual({ matchedIds: null, wouldAffect: 7 })
  })

  const refusals: Array<[string, Record<string, unknown> | null, Partial<typeof input>]> = [
    ['no row', null, {}],
    ['a preview made by the other tool', stored({ tool: 'esite_db_delete' }), {}],
    ['a different patch (digest differs)', stored(), { args: { ...args, patch: { status: 'open' } } }],
    ['a different filter', stored(), { args: { ...args, filters: [{ column: 'status', op: 'eq', value: 'closed' }] } }],
    ['an already consumed preview', stored({ consumed_at: NOW.toISOString() }), {}],
    ['a preview made 25 h ago', stored({ created_at: new Date(NOW.getTime() - 25 * HOUR).toISOString() }), {}],
    ['an unreadable created_at', stored({ created_at: 'not a date' }), {}],
  ]
  it.each(refusals)('refuses %s with the sentence and does not update', async (_name, row, over) => {
    const { ctx, calls, respond } = setup()
    respond({ data: row })
    await expect(consumePreview(ctx, { ...input, ...over })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
    expect(calls.some(c => c.method === 'update')).toBe(false)
  })

  it('a preview just inside 24 h is accepted', async () => {
    const { ctx, respond } = setup()
    respond({ data: stored({ created_at: new Date(NOW.getTime() - 24 * HOUR + 1000).toISOString() }) })
    respond({ data: [{ id: PID }] })
    await expect(consumePreview(ctx, input)).resolves.toMatchObject({ wouldAffect: 2 })
  })

  it('refuses when the consuming update touches no row (a concurrent confirm won)', async () => {
    const { ctx, respond } = setup()
    respond({ data: stored() })
    respond({ data: [] })
    await expect(consumePreview(ctx, input)).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
  })

  it('surfaces a read error as a database refusal', async () => {
    const { ctx, respond } = setup()
    respond({ data: null, error: { code: '42501', message: 'denied' } })
    await expect(consumePreview(ctx, input)).rejects.toThrow('Database error 42501: denied')
  })
})
