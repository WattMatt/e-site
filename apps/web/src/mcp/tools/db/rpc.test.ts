import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext, type RegisteredTool } from '../../define-tool'
import { UNKNOWN_SCHEMA, BAD_IDENT } from './sentences'
import { esiteDbRpc } from './rpc'
import { dbTools } from './index'

const WM = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'

function setup(role = 'owner') {
  const f = fakeClient()
  const schemaSpy = vi.spyOn(f.client, 'schema')
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [{ organisationId: WM, role }] } as unknown as ToolContext
  const parse = (args: unknown) => z.object(esiteDbRpc.inputSchema).parse(args)
  const run = (args: unknown) => (esiteDbRpc as RegisteredTool).handler(parse(args) as never, ctx) as Promise<Out>
  return { ...f, run, parse, schemaSpy }
}
type Out = { result: unknown; maskedColumns: string[]; ids: string[] }

describe('esite_db_rpc', () => {
  it('is registered, declared as a write tool, and its description says what readOnly does and does not do', () => {
    expect(dbTools).toContain(esiteDbRpc)
    expect(esiteDbRpc.name).toBe('esite_db_rpc')
    expect(esiteDbRpc.kind).toBe('write')
    expect(esiteDbRpc.description).toMatch(/any exposed database function/)
    expect(esiteDbRpc.description).toMatch(/POST/)
    expect(esiteDbRpc.description).toMatch(/readOnly: true only changes how the call is audited and rate-limited/)
    expect(esiteDbRpc.description).toMatch(/not a guarantee/)
    expect(esiteDbRpc.description).toMatch(/cost mask/)
  })

  it('defaults to schema public, readOnly false', () => {
    const { parse } = setup()
    expect(parse({ fn: 'f' })).toEqual({ schema: 'public', fn: 'f', readOnly: false })
  })

  it('kindOf is read when readOnly, write otherwise', () => {
    const { parse } = setup()
    const kindOf = esiteDbRpc.kindOf as (a: unknown) => string
    expect(kindOf(parse({ fn: 'f', readOnly: true }))).toBe('read')
    expect(kindOf(parse({ fn: 'f' }))).toBe('write')
    expect(kindOf(parse({ fn: 'f', readOnly: false }))).toBe('write')
  })

  it('calls the function on the named schema with the args, and on public with {} when none are given', async () => {
    const { run, calls, respond, schemaSpy } = setup()
    respond({ data: 3 })
    const out = await run({ fn: 'count_things' })
    expect(schemaSpy).toHaveBeenCalledWith('public')
    expect(calls).toEqual([{ path: 'rpc:count_things', method: 'rpc', args: [{}] }])
    expect(out).toEqual({ result: 3, maskedColumns: [], ids: [] })

    respond({ data: null })
    await run({ schema: 'tariffs', fn: 'lookup', args: { p_year: 2026 } })
    expect(schemaSpy).toHaveBeenLastCalledWith('tariffs')
    expect(calls[1]).toEqual({ path: 'rpc:lookup', method: 'rpc', args: [{ p_year: 2026 }] })
  })

  it('refuses an unexposed schema and a function name that is not a plain identifier, without calling', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'auth', fn: 'uid' })).rejects.toThrow(new ToolRefusal(UNKNOWN_SCHEMA))
    await expect(run({ fn: 'a.b' })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    await expect(run({ fn: 'f(); drop' })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    expect(calls).toEqual([])
  })

  it('masks cost keys in the result for a contractor, reports them, and returns the row ids', async () => {
    const { run, respond } = setup('contractor')
    respond({ data: [{ id: 'x', rate: 2 }] })
    const out = await run({ fn: 'price_lines' })
    expect(out.result).toEqual([{ id: 'x', rate: null }])
    expect(out.maskedColumns).toEqual(['rate'])
    expect(out.ids).toEqual(['x'])
  })

  it('leaves the same result untouched for an owner', async () => {
    const { run, respond } = setup('owner')
    respond({ data: [{ id: 'x', rate: 2 }] })
    const out = await run({ fn: 'price_lines' })
    expect(out.result).toEqual([{ id: 'x', rate: 2 }])
    expect(out.maskedColumns).toEqual([])
    expect(out.ids).toEqual(['x'])
  })

  it('ids: strings and numbers through String; rows without an id, and results that are not arrays of objects, give none', async () => {
    const { run, respond } = setup()
    respond({ data: [{ id: 'a' }, { id: 7 }, { name: 'no id' }, { id: null }] })
    expect((await run({ fn: 'f' })).ids).toEqual(['a', '7'])
    respond({ data: { id: 'scalar-object' } })
    expect((await run({ fn: 'f' })).ids).toEqual([])
    respond({ data: [1, 2] })
    expect((await run({ fn: 'f' })).ids).toEqual([])
    respond({ data: null })
    expect((await run({ fn: 'f' })).ids).toEqual([])
  })

  it('a PostgREST error surfaces as the database error sentence', async () => {
    const { run, respond } = setup()
    respond({ data: null, error: { code: '42883', message: 'function public.nope() does not exist', details: null, hint: null } })
    await expect(run({ fn: 'nope' })).rejects.toThrow(new ToolRefusal('Database error 42883: function public.nope() does not exist'))
  })
})
