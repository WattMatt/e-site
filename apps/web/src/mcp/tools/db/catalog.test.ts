import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext, type RegisteredTool } from '../../define-tool'
import { UNKNOWN_SCHEMA } from './sentences'
import { esiteDbSchemas } from './catalog'

function setup() {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [{ organisationId: 'o1', role: 'owner' }] } as unknown as ToolContext
  const run = (args: unknown) => (esiteDbSchemas as RegisteredTool).handler(z.object(esiteDbSchemas.inputSchema).parse(args) as never, ctx) as Promise<Record<string, unknown>>
  return { ...f, run }
}

describe('esite_db_schemas', () => {
  it('is a read tool', () => {
    expect(esiteDbSchemas.name).toBe('esite_db_schemas')
    expect(esiteDbSchemas.kind).toBe('read')
  })
  it('with no argument asks for the schema list', async () => {
    const { run, calls, respond } = setup()
    respond({ data: [{ schema: 'public' }] })
    expect(await run({})).toEqual({ schemas: [{ schema: 'public' }] })
    expect(calls).toEqual([{ path: 'rpc:mcp_catalog', method: 'rpc', args: [{ p_schema: null }] }])
  })
  it('with a schema asks for its tables', async () => {
    const { run, calls, respond } = setup()
    respond({ data: [{ table: 'a' }] })
    expect(await run({ schema: 'solar' })).toEqual({ schema: 'solar', tables: [{ table: 'a' }] })
    expect(calls[0].args).toEqual([{ p_schema: 'solar' }])
  })
  it('refuses an unexposed schema with the sentence and does not call the database', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'auth' })).rejects.toThrow(new ToolRefusal(UNKNOWN_SCHEMA))
    expect(calls).toEqual([])
  })
  it('surfaces a database error as a refusal', async () => {
    const { run, respond } = setup()
    respond({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(run({})).rejects.toThrow('Database error 42501: permission denied')
  })
})
