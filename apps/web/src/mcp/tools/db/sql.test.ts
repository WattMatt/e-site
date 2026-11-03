import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext, type RegisteredTool } from '../../define-tool'
import { SQL_ROLE, SQL_ONLY_SELECT } from './sentences'
import { esiteDbSql } from './sql'

const O1 = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const O2 = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'

function setup(memberships: Array<{ organisationId: string; role: string }>) {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships } as unknown as ToolContext
  const run = (args: unknown) => (esiteDbSql as RegisteredTool).handler(z.object(esiteDbSql.inputSchema).parse(args) as never, ctx) as Promise<{ rows: unknown[]; rowCount: number; truncated: boolean }>
  return { ...f, run }
}

describe('esite_db_sql', () => {
  it('is a read tool and its description states the rules', () => {
    expect(esiteDbSql.kind).toBe('read')
    expect(esiteDbSql.description).toMatch(/read-only SELECT/)
    expect(esiteDbSql.description).toMatch(/8 s/)
    expect(esiteDbSql.description).toMatch(/net/)
    expect(esiteDbSql.description).toMatch(/every organisation/)
    expect(esiteDbSql.description).toMatch(/every project/)
    expect(esiteDbSql.description).toMatch(/NOT cost-masked per row/)
  })
  it('refuses an empty statement at input parsing', () => {
    expect(() => z.object(esiteDbSql.inputSchema).parse({ sql: '' })).toThrow()
  })
  it('refuses a contractor with the sentence and never calls the database', async () => {
    const { run, calls } = setup([{ organisationId: O1, role: 'contractor' }])
    await expect(run({ sql: 'select 1' })).rejects.toThrow(new ToolRefusal(SQL_ROLE))
    expect(calls).toEqual([])
  })
  it('refuses an owner who is only a contractor in another organisation', async () => {
    const { run, calls } = setup([{ organisationId: O1, role: 'owner' }, { organisationId: O2, role: 'contractor' }])
    await expect(run({ sql: 'select 1' })).rejects.toThrow(SQL_ROLE)
    expect(calls).toEqual([])
  })
  it('refuses an org owner who is a contractor on one project, after reading their project rows, and never runs the SQL', async () => {
    const { run, calls, respond } = setup([{ organisationId: O1, role: 'owner' }])
    respond({ data: [{ role: 'project_manager' }, { role: 'contractor' }] })
    await expect(run({ sql: 'select 1' })).rejects.toThrow(new ToolRefusal(SQL_ROLE))
    expect(calls.filter(c => c.path === 'rpc:mcp_run_select')).toEqual([])
  })
  it('refuses when the project-rows read fails (fail closed)', async () => {
    const { run, calls, respond } = setup([{ organisationId: O1, role: 'owner' }])
    respond({ data: null, error: { message: 'boom' } })
    await expect(run({ sql: 'select 1' })).rejects.toThrow(new ToolRefusal(SQL_ROLE))
    expect(calls.filter(c => c.path === 'rpc:mcp_run_select')).toEqual([])
  })
  it('runs for a cost role everywhere and returns the rows', async () => {
    const { run, calls, respond } = setup([{ organisationId: O1, role: 'owner' }, { organisationId: O2, role: 'project_manager' }])
    respond({ data: [{ role: 'project_manager' }] })
    respond({ data: [{ a: 1 }, { a: 2 }] })
    expect(await run({ sql: 'select a from t' })).toEqual({ rows: [{ a: 1 }, { a: 2 }], rowCount: 2, truncated: false })
    expect(calls.map(c => c.path)).toEqual(['projects.project_members', 'projects.project_members', 'projects.project_members', 'rpc:mcp_run_select'])
    expect(calls[3]).toEqual({ path: 'rpc:mcp_run_select', method: 'rpc', args: [{ p_sql: 'select a from t' }] })
  })
  it('returns 1000 rows and truncated when 1001 come back', async () => {
    const { run, respond } = setup([{ organisationId: O1, role: 'admin' }])
    respond({ data: [] })
    respond({ data: Array.from({ length: 1001 }, (_, i) => ({ i })) })
    const out = await run({ sql: 'select i from t' })
    expect(out.rows).toHaveLength(1000)
    expect(out.rowCount).toBe(1000)
    expect(out.truncated).toBe(true)
  })
  it('exactly 1000 rows is not truncated', async () => {
    const { run, respond } = setup([{ organisationId: O1, role: 'admin' }])
    respond({ data: [] })
    respond({ data: Array.from({ length: 1000 }, (_, i) => ({ i })) })
    expect((await run({ sql: 'select i from t' })).truncated).toBe(false)
  })
  it('passes the function\'s read-only sentence through alone', async () => {
    const { run, respond } = setup([{ organisationId: O1, role: 'owner' }])
    respond({ data: [] })
    respond({ data: null, error: { code: 'P0001', message: SQL_ONLY_SELECT } })
    await expect(run({ sql: 'delete from t' })).rejects.toThrow(new ToolRefusal(SQL_ONLY_SELECT))
  })
  it('passes the function\'s role sentence through alone', async () => {
    const { run, respond } = setup([{ organisationId: O1, role: 'owner' }])
    respond({ data: [] })
    respond({ data: null, error: { code: 'P0001', message: SQL_ROLE } })
    await expect(run({ sql: 'select 1' })).rejects.toThrow(new ToolRefusal(SQL_ROLE))
  })
})
