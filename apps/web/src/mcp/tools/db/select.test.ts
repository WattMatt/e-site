import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext, type RegisteredTool } from '../../define-tool'
import { UNKNOWN_SCHEMA, BAD_IDENT, MASKED_COLUMN } from './sentences'
import { esiteDbSelect } from './select'

const I1 = '44444444-4444-4444-8444-444444444444'
const P1 = '11111111-1111-4111-8111-111111111111'
const WM = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'

function setup(role = 'owner') {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [{ organisationId: WM, role }] } as unknown as ToolContext
  const parse = (args: unknown) => z.object(esiteDbSelect.inputSchema).parse(args)
  const run = (args: unknown) => (esiteDbSelect as RegisteredTool).handler(parse(args) as never, ctx) as Promise<Out>
  return { ...f, run, parse }
}
type Out = { rows: Record<string, unknown>[]; count: number | null; nextOffset: number | null; truncated: boolean; maskedColumns: string[] }
const r1 = { id: 'a', field_id: 'f1' }
const r2 = { id: 'b', field_id: 'f2' }

describe('esite_db_select', () => {
  it('is a read tool whose description names fts syntax and the cost mask', () => {
    expect(esiteDbSelect.kind).toBe('read')
    expect(esiteDbSelect.description).toMatch(/to_tsquery/)
    expect(esiteDbSelect.description).toMatch(/&/)
    expect(esiteDbSelect.description).toMatch(/null/)
    expect(esiteDbSelect.description).toMatch(/maskedColumns/)
    expect(esiteDbSelect.description).toMatch(/approximate/)
  })

  it('selects with filters, order and range, and returns paging', async () => {
    const { run, calls, respond } = setup()
    respond({ data: [r1, r2], count: 5 })
    const out = await run({ schema: 'inspections', table: 'responses', filters: [{ column: 'inspection_id', op: 'eq', value: I1 }], order: [{ column: 'field_id' }], limit: 2, offset: 0 })
    expect(calls.map(c => [c.path, c.method, c.args])).toEqual([
      ['inspections.responses', 'select', ['*', { count: 'estimated' }]],
      ['inspections.responses', 'eq', ['inspection_id', I1]],
      ['inspections.responses', 'order', ['field_id', { ascending: true }]],
      ['inspections.responses', 'range', [0, 1]],
    ])
    expect(out).toEqual({ rows: [r1, r2], count: 5, nextOffset: 2, truncated: true, maskedColumns: [] })
  })

  it('honours ascending false and an offset', async () => {
    const { run, calls, respond } = setup()
    respond({ data: [r1], count: 10 })
    await run({ schema: 'inspections', table: 'responses', order: [{ column: 'field_id', ascending: false }], limit: 1, offset: 4 })
    expect(calls.find(c => c.method === 'order')?.args).toEqual(['field_id', { ascending: false }])
    expect(calls.find(c => c.method === 'range')?.args).toEqual([4, 4])
  })

  it('the last page has nextOffset null and truncated false', async () => {
    const { run, respond } = setup()
    respond({ data: [r1, r2], count: 5 })
    const out = await run({ schema: 'inspections', table: 'responses', limit: 2, offset: 3 })
    expect(out).toMatchObject({ rows: [r1, r2], count: 5, nextOffset: null, truncated: false })
  })

  it('defaults to limit 100 and offset 0', () => {
    const { parse } = setup()
    expect(parse({ schema: 'public', table: 'x' })).toMatchObject({ limit: 100, offset: 0 })
  })

  it('refuses an unexposed schema with the sentence', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'auth', table: 'users' })).rejects.toThrow(new ToolRefusal(UNKNOWN_SCHEMA))
    expect(calls).toEqual([])
  })

  it('refuses a table name with a dot, a bad column, and a bad order column', async () => {
    const { run, calls } = setup()
    await expect(run({ schema: 'projects', table: 'projects.boq_items' })).rejects.toThrow(new ToolRefusal(BAD_IDENT))
    await expect(run({ schema: 'projects', table: 'projects', columns: ['id', 'a->b'] })).rejects.toThrow(BAD_IDENT)
    await expect(run({ schema: 'projects', table: 'projects', order: [{ column: 'x:y' }] })).rejects.toThrow(BAD_IDENT)
    expect(calls).toEqual([])
  })

  it('refuses an order on a masked column for a contractor, and allows it for an owner', async () => {
    const c = setup('contractor')
    await expect(c.run({ schema: 'projects', table: 'projects', order: [{ column: 'contract_value' }] })).rejects.toThrow(new ToolRefusal(MASKED_COLUMN))
    await expect(c.run({ schema: 'projects', table: 'projects', filters: [{ column: 'contract_value', op: 'gt', value: 1 }] })).rejects.toThrow(MASKED_COLUMN)
    expect(c.calls).toEqual([])
    const o = setup('owner')
    o.respond({ data: [] }) // the owner's active project memberships: none
    o.respond({ data: [], count: 0 })
    await expect(o.run({ schema: 'projects', table: 'projects', order: [{ column: 'contract_value' }] })).resolves.toMatchObject({ rows: [], count: 0 })
    expect(o.calls.map(c => c.path)).toEqual([
      'projects.project_members', 'projects.project_members', 'projects.project_members',
      'projects.projects', 'projects.projects', 'projects.projects',
    ])
  })

  it('refuses an order on a masked column for an org owner who is a contractor on one project', async () => {
    const o = setup('owner')
    o.respond({ data: [{ role: 'contractor' }] })
    await expect(o.run({ schema: 'projects', table: 'projects', order: [{ column: 'contract_value' }] })).rejects.toThrow(new ToolRefusal(MASKED_COLUMN))
    expect(o.calls.filter(c => c.path === 'projects.projects')).toEqual([])
  })

  it('fetches organisation_id internally for an org-owned masked table, masks by it, and strips it', async () => {
    const back = [{ id: 'i1', amount_kobo: 500, organisation_id: WM }]
    const c = setup('contractor')
    c.respond({ data: back, count: 1 })
    const masked = await c.run({ schema: 'billing', table: 'invoices', columns: ['id', 'amount_kobo'] })
    expect(c.calls[0]).toMatchObject({ path: 'billing.invoices', method: 'select', args: ['id,amount_kobo,organisation_id', { count: 'estimated' }] })
    expect(masked.rows).toEqual([{ id: 'i1', amount_kobo: null }])
    expect(masked.maskedColumns).toEqual(['amount_kobo'])
    // the same row is intact for the owner of that organisation, with no project lookup
    const o = setup('owner')
    o.respond({ data: back, count: 1 })
    const open = await o.run({ schema: 'billing', table: 'invoices', columns: ['id', 'amount_kobo'] })
    expect(open.rows).toEqual([{ id: 'i1', amount_kobo: 500 }])
    expect(o.calls.map(c => c.path)).toEqual(['billing.invoices', 'billing.invoices'])
  })

  it('does not add organisation_id to a masked table that has none (projects.boq_items)', async () => {
    const o = setup('owner')
    o.respond({ data: [{ id: 'b1', rate: 3 }], count: 1 })
    await o.run({ schema: 'projects', table: 'boq_items', columns: ['id', 'rate'] })
    expect(o.calls[0].args).toEqual(['id,rate', { count: 'estimated' }])
  })

  it('fetches the project key internally (project_id), masks per row, and strips it', async () => {
    const { run, calls, respond } = setup('contractor')
    respond({ data: [{ id: 'v1', net_change: 500, project_id: P1 }], count: 1 })
    respond({ data: 'contractor' })
    const out = await run({ schema: 'projects', table: 'variation_orders', columns: ['id', 'net_change'] })
    expect(calls[0]).toMatchObject({ path: 'projects.variation_orders', method: 'select', args: ['id,net_change,project_id', { count: 'estimated' }] })
    expect(calls.find(c => c.path === 'rpc:user_effective_project_role')?.args).toEqual([{ p_project_id: P1, p_user_id: 'u1' }])
    expect(out.rows).toEqual([{ id: 'v1', net_change: null }])
    expect(out.rows[0]).not.toHaveProperty('project_id')
    expect(out.maskedColumns).toEqual(['net_change'])
  })

  it('the same row is not masked for a project role that may see cost', async () => {
    const { run, respond } = setup('owner')
    respond({ data: [{ id: 'v1', net_change: 500, project_id: P1 }], count: 1 })
    respond({ data: 'project_manager' })
    const out = await run({ schema: 'projects', table: 'variation_orders', columns: ['id', 'net_change'] })
    expect(out.rows).toEqual([{ id: 'v1', net_change: 500 }])
    expect(out.maskedColumns).toEqual([])
  })

  it('fetches id internally for projects.projects and strips it', async () => {
    const { run, calls, respond } = setup('owner')
    respond({ data: [{ code: 'K1', contract_value: 9, id: P1 }], count: 1 })
    respond({ data: 'contractor' })
    const out = await run({ schema: 'projects', table: 'projects', columns: ['code', 'contract_value'] })
    expect(calls[0].args).toEqual(['code,contract_value,id', { count: 'estimated' }])
    expect(out.rows).toEqual([{ code: 'K1', contract_value: null }])
    expect(out.rows[0]).not.toHaveProperty('id')
  })

  it('keeps the key column when the caller asked for it and does not duplicate it', async () => {
    const { run, calls, respond } = setup('owner')
    respond({ data: [{ id: P1, contract_value: 9 }], count: 1 })
    respond({ data: 'owner' })
    const out = await run({ schema: 'projects', table: 'projects', columns: ['id', 'contract_value'] })
    expect(calls[0].args).toEqual(['id,contract_value', { count: 'estimated' }])
    expect(out.rows).toEqual([{ id: P1, contract_value: 9 }])
  })

  it('surfaces a PostgREST error as a refusal with code and message', async () => {
    const { run, respond } = setup()
    respond({ data: null, error: { code: '42P01', message: 'relation "projects.nope" does not exist' } })
    await expect(run({ schema: 'projects', table: 'nope' })).rejects.toThrow('Database error 42P01: relation "projects.nope" does not exist')
  })

  it('limit above 1000 fails input parsing', () => {
    expect(() => z.object(esiteDbSelect.inputSchema).parse({ schema: 'public', table: 'x', limit: 1001 })).toThrow()
    expect(() => z.object(esiteDbSelect.inputSchema).parse({ schema: 'public', table: 'x', limit: 0 })).toThrow()
  })

  it('projectIdOf reads an eq filter on project_id', () => {
    const { parse } = setup()
    const f = esiteDbSelect.projectIdOf as (a: unknown) => string | null
    expect(f(parse({ schema: 'projects', table: 'x', filters: [{ column: 'project_id', op: 'eq', value: P1 }] }))).toBe(P1)
    expect(f(parse({ schema: 'projects', table: 'x' }))).toBeNull()
  })
})
