import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext, type RegisteredTool } from '../../define-tool'
import { argsDigest } from '../../audit'
import { NEED_FILTER, EMPTY_PATCH, DENYLISTED, MASKED_COLUMN, BAD_IDENT, PREVIEW_MISMATCH, PREVIEW_TOO_WIDE, UNKNOWN_SCHEMA } from './sentences'
import { esiteDbUpdate, esiteDbDelete } from './mutate'

const NOW = new Date('2026-11-03T10:00:00.000Z')
const PREV = '99999999-9999-4999-8999-999999999999'
const P1 = '11111111-1111-4111-8111-111111111111'
const WM = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const filters = [{ column: 'status', op: 'eq', value: 'open' }]
const patch = { status: 'closed' }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

type PreviewOut = { previewId: string; wouldAffect: number; sample: Record<string, unknown>[]; expiresAt: string }
type WriteOut = Record<string, unknown> & { ids: string[]; rows: Record<string, unknown>[] }

function setup(tool: RegisteredTool, role = 'owner') {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [{ organisationId: WM, role }] } as unknown as ToolContext
  const parse = (args: unknown) => z.object(tool.inputSchema).parse(args)
  const run = (args: unknown) => tool.handler(parse(args) as never, ctx) as Promise<never>
  return { ...f, run, parse }
}

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}`, status: 'open' }))
const storedRow = (tool: string, args: unknown, over: Record<string, unknown> = {}) => ({
  id: PREV, tool, args_digest: argsDigest(args), matched_ids: ['a', 'b'], would_affect: 2,
  created_at: new Date(NOW.getTime() - 3_600_000).toISOString(), consumed_at: null, ...over,
})

describe.each([
  ['update', 'esite_db_update', esiteDbUpdate as RegisteredTool],
  ['delete', 'esite_db_delete', esiteDbDelete as RegisteredTool],
] as const)('esite_db_%s', (verb, name, tool) => {
  const base = { schema: 'projects', table: 'rfis', filters }
  const withPatch = verb === 'update' ? { ...base, patch } : base
  const digestArgs = verb === 'update' ? { schema: 'projects', table: 'rfis', filters, patch } : { schema: 'projects', table: 'rfis', filters }

  it('is named, declared a write, and a preview without previewId (kindOf)', () => {
    expect(tool.name).toBe(name)
    expect(tool.kind).toBe('write')
    const kindOf = tool.kindOf as (a: unknown) => string
    expect(kindOf({ ...withPatch })).toBe('preview')
    expect(kindOf({ ...withPatch, previewId: PREV })).toBe('write')
  })

  it('the description names the preview, the 24 h single confirm, the changed-rows refusal, managed tables and the mask', () => {
    for (const re of [/previewId/, /wouldAffect/, /sample/, /expiresAt/, /24 hours/, /same person/, /changed/, /managed in the app/, /null/]) expect(tool.description).toMatch(re)
  })

  it('refuses zero filters with the sentence and runs no query', async () => {
    const { run, calls } = setup(tool)
    await expect(run({ ...withPatch, filters: [] })).rejects.toThrow(new ToolRefusal(NEED_FILTER))
    expect(calls).toEqual([])
  })

  it('refuses a denylisted table', async () => {
    const { run, calls } = setup(tool)
    await expect(run({ ...withPatch, schema: 'projects', table: 'project_members' })).rejects.toThrow(new ToolRefusal(DENYLISTED))
    expect(calls).toEqual([])
  })

  it('refuses an unexposed schema and a bad table name', async () => {
    const { run, calls } = setup(tool)
    await expect(run({ ...withPatch, schema: 'auth' })).rejects.toThrow(new ToolRefusal(UNKNOWN_SCHEMA))
    await expect(run({ ...withPatch, table: 'rfis.x' })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    expect(calls).toEqual([])
  })

  it('refuses a filter on a masked column for a contractor', async () => {
    const { run, calls } = setup(tool, 'contractor')
    await expect(run({ ...withPatch, table: 'boq_items', filters: [{ column: 'rate', op: 'gt', value: 1 }] })).rejects.toThrow(new ToolRefusal(MASKED_COLUMN))
    expect(calls).toEqual([])
  })

  it('refuses a filter column that is not an identifier, before any query', async () => {
    const { run, calls } = setup(tool)
    await expect(run({ ...withPatch, filters: [{ column: 'a->b', op: 'eq', value: 1 }] })).rejects.toThrow(BAD_IDENT)
    expect(calls).toEqual([])
  })

  it('preview: selects with count, stores sorted ids, returns a masked sample of at most 50 and expiresAt', async () => {
    const { run, calls, respond } = setup(tool)
    const shuffled = rowsOf(60).reverse()
    respond({ data: shuffled, count: 60 })
    respond({ data: [] })
    respond({ data: { id: PREV, created_at: NOW.toISOString() } })
    const out = (await run(withPatch)) as PreviewOut
    expect(calls.slice(0, 3).map(c => [c.path, c.method, c.args])).toEqual([
      ['projects.rfis', 'select', ['*', { count: 'exact' }]],
      ['projects.rfis', 'eq', ['status', 'open']],
      ['projects.rfis', 'limit', [1000]],
    ])
    expect(calls.some(c => ['update', 'delete'].includes(c.method) && c.path === 'projects.rfis')).toBe(false)
    const insert = calls.find(c => c.path === 'public.mcp_previews' && c.method === 'insert')!
    expect(insert.args).toEqual([{
      tool: name, args_digest: argsDigest(digestArgs),
      matched_ids: rowsOf(60).map(r => r.id), would_affect: 60,
    }])
    expect(out.previewId).toBe(PREV)
    expect(out.wouldAffect).toBe(60)
    expect(out.sample).toHaveLength(50)
    expect(out.expiresAt).toBe('2026-11-04T10:00:00.000Z')
  })

  it('preview: the sample is masked for a contractor and not for an owner', async () => {
    const mk = (role: string) => {
      const s = setup(tool, role)
      s.respond({ data: [{ id: 'b1', rate: 9 }], count: 1 })
      s.respond({ data: [] })
      s.respond({ data: { id: PREV, created_at: NOW.toISOString() } })
      return s
    }
    const c = mk('contractor')
    const masked = (await c.run({ ...withPatch, table: 'boq_items' })) as PreviewOut
    expect(masked.sample).toEqual([{ id: 'b1', rate: null }])
    const o = mk('owner')
    const open = (await o.run({ ...withPatch, table: 'boq_items' })) as PreviewOut
    expect(open.sample).toEqual([{ id: 'b1', rate: 9 }])
  })

  it('preview: a table without an id column stores count-only (matched_ids null)', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: [{ code: 'x' }, { code: 'y' }, { code: 'z' }], count: 3 })
    respond({ data: [] })
    respond({ data: { id: PREV, created_at: NOW.toISOString() } })
    await run(withPatch)
    expect(calls.find(c => c.method === 'insert')?.args).toEqual([expect.objectContaining({ matched_ids: null, would_affect: 3 })])
  })

  it('preview: zero matching rows is a preview of nothing, not an error', async () => {
    const { run, respond } = setup(tool)
    respond({ data: [], count: 0 })
    respond({ data: [] })
    respond({ data: { id: PREV, created_at: NOW.toISOString() } })
    const out = (await run(withPatch)) as PreviewOut
    expect(out).toMatchObject({ wouldAffect: 0, sample: [] })
  })

  it('preview: refuses when the count exceeds 1000', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: rowsOf(1000), count: 1001 })
    await expect(run(withPatch)).rejects.toThrow(new ToolRefusal(PREVIEW_TOO_WIDE))
    expect(calls.some(c => c.path === 'public.mcp_previews')).toBe(false)
  })

  it('preview: surfaces a database error from the select', async () => {
    const { run, respond } = setup(tool)
    respond({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
    await expect(run(withPatch)).rejects.toThrow('Database error 42P01: relation does not exist')
  })

  it('confirm: refuses when the id set changed, and writes nothing', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs) })      // preview row: ids [a, b]
    respond({ data: [{ id: PREV }] })                  // consumed
    respond({ data: [{ id: 'a' }, { id: 'c' }], count: 2 }) // now a, c
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
    expect(calls.some(c => c.path === 'projects.rfis' && (c.method === 'update' || c.method === 'delete'))).toBe(false)
  })

  it('confirm: refuses when a row was added (count differs) even though the stored ids are still present', async () => {
    const { run, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs) })
    respond({ data: [{ id: PREV }] })
    respond({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], count: 3 })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
  })

  it('confirm: refuses a preview made for a different patch/filters (digest)', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: storedRow(name, { ...digestArgs, filters: [{ column: 'status', op: 'eq', value: 'closed' }] }) })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
    expect(calls.filter(c => c.path === 'projects.rfis')).toEqual([])
  })

  it('confirm: refuses a preview made by the other tool', async () => {
    const { run, respond } = setup(tool)
    respond({ data: storedRow(name === 'esite_db_update' ? 'esite_db_delete' : 'esite_db_update', digestArgs) })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
  })

  it('confirm: runs the write with the same filters and returns ids and masked rows', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs) })
    respond({ data: [{ id: PREV }] })
    respond({ data: [{ id: 'b' }, { id: 'a' }], count: 2 })
    respond({ data: [{ id: 'a', status: 'closed' }, { id: 'b', status: 'closed' }] })
    const out = (await run({ ...withPatch, previewId: PREV })) as WriteOut
    const rfis = calls.filter(c => c.path === 'projects.rfis').map(c => [c.method, c.args])
    expect(rfis).toEqual([
      ['select', ['id', { count: 'exact' }]], ['eq', ['status', 'open']], ['limit', [1000]],
      verb === 'update' ? ['update', [patch]] : ['delete', []],
      ['eq', ['status', 'open']],
      ['select', ['*']],
    ])
    expect(out[verb === 'update' ? 'updated' : 'deleted']).toBe(2)
    expect(out.ids).toEqual(['a', 'b'])
    expect(out.rows).toHaveLength(2)
  })

  it('confirm: the returned rows are masked for a contractor and the same rows are intact for an owner', async () => {
    const d = { schema: 'projects', table: 'boq_items', filters, ...(verb === 'update' ? { patch: { description: 'x' } } : {}) }
    const confirm = async (role: string) => {
      const s = setup(tool, role)
      s.respond({ data: storedRow(name, d) })
      s.respond({ data: [{ id: PREV }] })
      s.respond({ data: [{ id: 'a' }, { id: 'b' }], count: 2 })
      s.respond({ data: [{ id: 'a', rate: 4 }, { id: 'b', rate: 5 }] })
      return (await s.run({ ...d, previewId: PREV })) as WriteOut
    }
    expect((await confirm('contractor')).rows).toEqual([{ id: 'a', rate: null }, { id: 'b', rate: null }])
    expect((await confirm('owner')).rows).toEqual([{ id: 'a', rate: 4 }, { id: 'b', rate: 5 }])
  })

  it('confirm: integer ids come back in ids as strings', async () => {
    const { run, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs, { matched_ids: ['1', '2'] }) })
    respond({ data: [{ id: PREV }] })
    respond({ data: [{ id: 2 }, { id: 1 }], count: 2 })
    respond({ data: [{ id: 1, status: 'x' }, { id: 2, status: 'x' }, { id: null }, { status: 'no id' }, { id: { a: 1 } }] })
    const out = (await run({ ...withPatch, previewId: PREV })) as WriteOut
    expect(out.ids).toEqual(['1', '2'])
  })

  it('confirm on a table without id (42703) compares counts only', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs, { matched_ids: null, would_affect: 3 }) })
    respond({ data: [{ id: PREV }] })
    respond({ data: null, error: { code: '42703', message: 'column "id" does not exist' } })
    respond({ data: null, count: 3 })
    respond({ data: [{ code: 'x' }, { code: 'y' }, { code: 'z' }] })
    const out = (await run({ ...withPatch, previewId: PREV })) as WriteOut
    expect(calls.filter(c => c.path === 'projects.rfis' && c.method === 'select').map(c => c.args)).toEqual([
      ['id', { count: 'exact' }], ['*', { count: 'exact', head: true }], ['*'],
    ])
    expect(out[verb === 'update' ? 'updated' : 'deleted']).toBe(3)
    expect(out.ids).toEqual([])
  })

  it('confirm on a table without id refuses when the count moved', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs, { matched_ids: null, would_affect: 3 }) })
    respond({ data: [{ id: PREV }] })
    respond({ data: null, error: { code: '42703', message: 'column "id" does not exist' } })
    respond({ data: null, count: 4 })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
    expect(calls.some(c => c.path === 'projects.rfis' && (c.method === 'update' || c.method === 'delete'))).toBe(false)
  })

  it('confirm with a count-only preview compares counts even when the table has id', async () => {
    const { run, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs, { matched_ids: null, would_affect: 2 }) })
    respond({ data: [{ id: PREV }] })
    respond({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], count: 3 })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
  })

  it('confirm: a second confirm of the same preview is refused (consumed)', async () => {
    const { run, calls, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs, { consumed_at: NOW.toISOString() }) })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
    expect(calls.filter(c => c.path === 'projects.rfis')).toEqual([])
  })

  it('confirm: surfaces a database error from the write', async () => {
    const { run, respond } = setup(tool)
    respond({ data: storedRow(name, digestArgs) })
    respond({ data: [{ id: PREV }] })
    respond({ data: [{ id: 'a' }, { id: 'b' }], count: 2 })
    respond({ data: null, error: { code: '23503', message: 'violates foreign key constraint' } })
    await expect(run({ ...withPatch, previewId: PREV })).rejects.toThrow('Database error 23503: violates foreign key constraint')
  })

  it('projectIdOf reads project_id from an eq filter', () => {
    const { parse } = setup(tool)
    const f = tool.projectIdOf as (a: unknown) => string | null
    expect(f(parse({ ...withPatch, filters: [{ column: 'project_id', op: 'eq', value: P1 }] }))).toBe(P1)
    expect(f(parse(withPatch))).toBeNull()
  })
})

describe('esite_db_update only', () => {
  const t = esiteDbUpdate as RegisteredTool
  it('refuses an empty patch with the sentence and runs no query', async () => {
    const { run, calls } = setup(t)
    await expect(run({ schema: 'projects', table: 'rfis', filters, patch: {} })).rejects.toThrow(new ToolRefusal(EMPTY_PATCH))
    expect(calls).toEqual([])
  })

  it('refuses a patch key that is not an identifier, with no query', async () => {
    const { run, calls } = setup(t)
    await expect(run({ schema: 'projects', table: 'rfis', filters, patch: { 'rate; drop': 1 } })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    await expect(run({ schema: 'projects', table: 'rfis', filters, patch: { status: 'x', 'a->b': 1 } })).rejects.toThrow(BAD_IDENT)
    expect(calls).toEqual([])
  })

  it('the patch is part of the digest: confirming with a different patch is refused', async () => {
    const { run, calls, respond } = setup(t)
    respond({ data: storedRow('esite_db_update', { schema: 'projects', table: 'rfis', filters, patch: { status: 'closed' } }) })
    await expect(run({ schema: 'projects', table: 'rfis', filters, patch: { status: 'void' }, previewId: PREV })).rejects.toThrow(new ToolRefusal(PREVIEW_MISMATCH))
    expect(calls.some(c => c.method === 'update' && c.path === 'projects.rfis')).toBe(false)
  })

  it('the preview digest covers exactly schema, table, filters and patch', async () => {
    const { run, calls, respond } = setup(t)
    respond({ data: [{ id: 'a' }], count: 1 })
    respond({ data: [] })
    respond({ data: { id: PREV, created_at: NOW.toISOString() } })
    await run({ schema: 'projects', table: 'rfis', filters, patch })
    const insert = calls.find(c => c.method === 'insert')!.args[0] as { args_digest: string }
    expect(insert.args_digest).toBe(argsDigest({ schema: 'projects', table: 'rfis', filters, patch }))
  })
})

describe('esite_db_delete only', () => {
  it('has no patch input', () => {
    expect(Object.keys(esiteDbDelete.inputSchema)).toEqual(['schema', 'table', 'filters', 'previewId'])
    expect(Object.keys(esiteDbUpdate.inputSchema)).toEqual(['schema', 'table', 'filters', 'patch', 'previewId'])
  })
})
