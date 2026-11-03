import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext, type RegisteredTool } from '../../define-tool'
import { UNKNOWN_SCHEMA, BAD_IDENT, DENYLISTED } from './sentences'
import { esiteDbInsert } from './insert'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const WM = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'

function setup(role = 'owner') {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [{ organisationId: WM, role }] } as unknown as ToolContext
  const parse = (args: unknown) => z.object(esiteDbInsert.inputSchema).parse(args)
  const run = (args: unknown) => (esiteDbInsert as RegisteredTool).handler(parse(args) as never, ctx) as Promise<{ inserted: number; ids: string[]; rows: Record<string, unknown>[] }>
  return { ...f, run, parse }
}

describe('esite_db_insert', () => {
  it('is a write tool; its description names the mask', () => {
    expect(esiteDbInsert.kind).toBe('write')
    expect(esiteDbInsert.description).toMatch(/null/)
    expect(esiteDbInsert.description).toMatch(/managed in the app/)
  })

  it('inserts, selects *, and returns inserted, ids and rows', async () => {
    const { run, calls, respond } = setup()
    const rows = [{ name: 'a' }, { name: 'b' }]
    const back = [{ id: 'r1', name: 'a' }, { id: 'r2', name: 'b' }]
    respond({ data: back })
    const out = await run({ schema: 'inspections', table: 'notes', rows })
    expect(calls.map(c => [c.path, c.method, c.args])).toEqual([
      ['inspections.notes', 'insert', [rows]],
      ['inspections.notes', 'select', ['*']],
    ])
    expect(out).toEqual({ inserted: 2, ids: ['r1', 'r2'], rows: back })
  })

  it('returning narrows the select list', async () => {
    const { run, calls, respond } = setup()
    respond({ data: [{ id: 'r1', name: 'a' }] })
    const out = await run({ schema: 'inspections', table: 'notes', rows: [{ name: 'a' }], returning: ['id', 'name'] })
    expect(calls[1]).toMatchObject({ method: 'select', args: ['id,name'] })
    expect(out.ids).toEqual(['r1'])
  })

  it('ids is empty when the rows carry no id', async () => {
    const { run, respond } = setup()
    respond({ data: [{ name: 'a' }] })
    expect((await run({ schema: 'inspections', table: 'notes', rows: [{ name: 'a' }], returning: ['name'] })).ids).toEqual([])
  })

  it('refuses a denylisted table with the sentence and runs no query', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'billing', table: 'invoices', rows: [{ a: 1 }] })).rejects.toThrow(new ToolRefusal(DENYLISTED))
    expect(calls).toEqual([])
  })

  it('refuses an unexposed schema', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'auth', table: 'users', rows: [{ a: 1 }] })).rejects.toThrow(new ToolRefusal(UNKNOWN_SCHEMA))
    expect(calls).toEqual([])
  })

  it('refuses a row key that is not an identifier, in any row, with no query', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'inspections', table: 'notes', rows: [{ name: 'a' }, { 'rate; drop': 1 }] })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    await expect(run({ schema: 'inspections', table: 'notes', rows: [{ 'a->b': 1 }] })).rejects.toThrow(BAD_IDENT)
    expect(calls).toEqual([])
  })

  it('refuses a bad table name and a bad returning column with no query', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'inspections', table: 'notes.x', rows: [{ a: 1 }] })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    await expect(run({ schema: 'inspections', table: 'notes', rows: [{ a: 1 }], returning: ['*'] })).rejects.toThrow(BAD_IDENT)
    expect(calls).toEqual([])
  })

  it('rows must be 1..500', () => {
    const { parse } = setup()
    expect(() => parse({ schema: 'inspections', table: 'notes', rows: [] })).toThrow()
    expect(() => parse({ schema: 'inspections', table: 'notes', rows: Array.from({ length: 501 }, () => ({ a: 1 })) })).toThrow()
    expect(() => parse({ schema: 'inspections', table: 'notes', rows: Array.from({ length: 500 }, () => ({ a: 1 })) })).not.toThrow()
  })

  it('masks the returned rows: a contractor gets rate null, an owner gets the number', async () => {
    const back = [{ id: 'b1', description: 'cable', rate: 12.5 }]
    const c = setup('contractor')
    c.respond({ data: back })
    const masked = await c.run({ schema: 'projects', table: 'boq_items', rows: [{ description: 'cable', rate: 12.5 }] })
    expect(masked.rows).toEqual([{ id: 'b1', description: 'cable', rate: null }])
    const o = setup('owner')
    o.respond({ data: back })
    const open = await o.run({ schema: 'projects', table: 'boq_items', rows: [{ description: 'cable', rate: 12.5 }] })
    expect(open.rows).toEqual(back)
  })

  it('returning without the project key masks per project, strips the key, and the same row is intact for a cost role', async () => {
    const back = [{ id: 'v1', net_change: 500, project_id: P1 }]
    const insert = (projectRole: string) => {
      const s = setup('contractor')
      s.respond({ data: back })
      s.respond({ data: projectRole })
      return s.run({ schema: 'projects', table: 'variation_orders', rows: [{ net_change: 500, project_id: P1 }], returning: ['id', 'net_change'] }).then(out => ({ out, calls: s.calls }))
    }
    const masked = await insert('contractor')
    expect(masked.calls[1]).toMatchObject({ method: 'select', args: ['id,net_change,project_id'] })
    expect(masked.out.rows).toEqual([{ id: 'v1', net_change: null }])
    const open = await insert('project_manager')
    expect(open.calls.find(c => c.path === 'rpc:user_effective_project_role')?.args).toEqual([{ p_project_id: P1, p_user_id: 'u1' }])
    expect(open.out.rows).toEqual([{ id: 'v1', net_change: 500 }])
  })

  it('a failed role lookup after the insert nulls the cost columns and keeps the ids', async () => {
    const back = [{ id: 'v1', net_change: 500, project_id: P1 }]
    const insert = (lookup: { data: unknown; error?: unknown }) => {
      const s = setup('owner')
      s.respond({ data: back })
      s.respond(lookup)
      return s.run({ schema: 'projects', table: 'variation_orders', rows: [{ net_change: 500, project_id: P1 }] })
    }
    expect(await insert({ data: null, error: { message: 'boom' } })).toEqual({ inserted: 1, ids: ['v1'], rows: [{ id: 'v1', net_change: null, project_id: P1 }] })
    expect((await insert({ data: 'owner' })).rows).toEqual(back)
  })

  it('returning without organisation_id on an org-owned masked table fetches it, masks by it and strips it', async () => {
    const back = [{ id: 'c1', supply_rate_per_m: 9, organisation_id: WM }]
    const c = setup('contractor')
    c.respond({ data: back })
    const out = await c.run({ schema: 'cable_schedule', table: 'cost_lines', rows: [{ supply_rate_per_m: 9 }], returning: ['id', 'supply_rate_per_m'] })
    expect(c.calls[1]).toMatchObject({ method: 'select', args: ['id,supply_rate_per_m,organisation_id'] })
    expect(out.rows).toEqual([{ id: 'c1', supply_rate_per_m: null }])
    const o = setup('owner')
    o.respond({ data: back })
    expect((await o.run({ schema: 'cable_schedule', table: 'cost_lines', rows: [{ supply_rate_per_m: 9 }], returning: ['id', 'supply_rate_per_m'] })).rows).toEqual([{ id: 'c1', supply_rate_per_m: 9 }])
  })

  it('integer ids come back in ids as strings; null, missing and object ids are dropped', async () => {
    const { run, respond } = setup()
    respond({ data: [{ id: 7 }, { id: 8 }, { id: null }, { name: 'no id' }, { id: { a: 1 } }] })
    expect((await run({ schema: 'inspections', table: 'notes', rows: [{ a: 1 }] })).ids).toEqual(['7', '8'])
  })

  it('returning: [] fails input parsing (it would build select(\'\'))', () => {
    const { parse } = setup()
    expect(() => parse({ schema: 'inspections', table: 'notes', rows: [{ a: 1 }], returning: [] })).toThrow()
  })

  it('surfaces a database error as a refusal', async () => {
    const { run, respond } = setup()
    respond({ data: null, error: { code: '23502', message: 'null value in column "name"' } })
    await expect(run({ schema: 'inspections', table: 'notes', rows: [{ a: 1 }] })).rejects.toThrow('Database error 23502: null value in column "name"')
  })

  it('projectIdOf reads the shared project_id of the rows', () => {
    const { parse } = setup()
    const f = esiteDbInsert.projectIdOf as (a: unknown) => string | null
    expect(f(parse({ schema: 'projects', table: 'x', rows: [{ project_id: P1 }, { project_id: P1 }] }))).toBe(P1)
    expect(f(parse({ schema: 'projects', table: 'x', rows: [{ project_id: P1 }, { project_id: P2 }] }))).toBeNull()
  })
})
