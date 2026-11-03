import { describe, it, expect } from 'vitest'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext } from '../../define-tool'
import { MASKED_COLUMN } from './sentences'
import { hasOrgCostRole, maskedColumnsOf, assertFilterableColumns, maskRows, maskRpcResult } from './mask'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

function ctxFor(role: string) {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: [{ organisationId: 'o1', role }] } as unknown as ToolContext
  return { ...f, ctx }
}

describe('hasOrgCostRole', () => {
  it('is true for owner, admin and project_manager and false for site roles', () => {
    for (const r of ['owner', 'admin', 'project_manager']) expect(hasOrgCostRole(ctxFor(r).ctx), r).toBe(true)
    for (const r of ['contractor', 'inspector', 'supplier', 'client_viewer']) expect(hasOrgCostRole(ctxFor(r).ctx), r).toBe(false)
  })
})

describe('maskedColumnsOf', () => {
  it('lists the masked columns of a table and nothing for an unmasked one', () => {
    expect(maskedColumnsOf('projects', 'projects')).toContain('contract_value')
    expect(maskedColumnsOf('inspections', 'responses')).toEqual([])
  })
})

describe('maskRows', () => {
  it('an org cost role sees every column unchanged', async () => {
    const { ctx, calls } = ctxFor('owner')
    const rows = [{ id: 'a', project_id: P1, contract_value: 100 }]
    const out = await maskRows('projects', 'projects', rows, ctx)
    expect(out.rows).toEqual([{ id: 'a', project_id: P1, contract_value: 100 }])
    expect(out.maskedColumns).toEqual([])
    expect(calls).toEqual([])
  })

  it('a contractor sees stated_total as null on projects.tenders, by per-row effective role', async () => {
    const { ctx, calls, respond } = ctxFor('contractor')
    respond({ data: 'project_manager' })
    respond({ data: 'contractor' })
    const rows = [
      { id: 't1', project_id: P1, stated_total: 100 },
      { id: 't2', project_id: P2, stated_total: 200 },
      { id: 't3', project_id: P1, stated_total: 300 },
    ]
    const out = await maskRows('projects', 'tenders', rows, ctx)
    expect(out.rows.map(r => r.stated_total)).toEqual([100, null, 300])
    expect(out.maskedColumns).toEqual(['stated_total'])
    expect(rows[1].stated_total).toBe(200) // the input is not mutated
    // the same rows are un-nulled for an owner (control: the null is the mask, not missing data)
    expect((await maskRows('projects', 'tenders', rows, ctxFor('owner').ctx)).rows.map(r => r.stated_total)).toEqual([100, 200, 300])
    const rpcCalls = calls.filter(c => c.path === 'rpc:user_effective_project_role')
    expect(rpcCalls).toHaveLength(2)
    expect(rpcCalls.map(c => c.args[0])).toEqual([{ p_project_id: P1, p_user_id: 'u1' }, { p_project_id: P2, p_user_id: 'u1' }])
  })

  it('a table without project_id masks by org role', async () => {
    const { ctx, calls } = ctxFor('contractor')
    // boq_items has no project_id column, so even a project_id key in the row is not trusted
    const rows = [{ id: 'r1', project_id: P1, rate: 12.5, description: 'cable' }]
    const out = await maskRows('projects', 'boq_items', rows, ctx)
    expect(out.rows).toEqual([{ id: 'r1', project_id: P1, rate: null, description: 'cable' }])
    expect(out.maskedColumns).toEqual(['rate'])
    expect(calls).toEqual([])
    expect((await maskRows('projects', 'boq_items', rows, ctxFor('admin').ctx)).rows).toEqual(rows)
  })

  it('a row without a usable project_id is masked even on a table that has one', async () => {
    const { ctx, calls } = ctxFor('contractor')
    const out = await maskRows('projects', 'tenders', [{ id: 'x', project_id: null, stated_total: 5 }, { id: 'y', project_id: 'not-a-uuid', stated_total: 6 }], ctx)
    expect(out.rows.map(r => r.stated_total)).toEqual([null, null])
    expect(calls).toEqual([])
    const lib = await maskRows('cable_schedule', 'rate_library', [{ id: 'g', project_id: null, supply_rate_per_m: 9 }], ctx)
    expect(lib.rows[0].supply_rate_per_m).toBeNull()
  })

  it('an unmasked table is returned unchanged with no role lookups', async () => {
    const { ctx, calls } = ctxFor('contractor')
    const rows = [{ id: 'a', project_id: P1, value_number: 7 }]
    const out = await maskRows('inspections', 'responses', rows, ctx)
    expect(out).toEqual({ rows, maskedColumns: [] })
    expect(calls).toEqual([])
  })

  it('reports only the masked columns that were present in a row', async () => {
    const { ctx } = ctxFor('contractor')
    const out = await maskRows('cable_schedule', 'rate_library', [{ id: 'r1', description: 'x' }], ctx)
    expect(out.maskedColumns).toEqual([])
  })

  it('a role lookup error refuses rather than showing the figure', async () => {
    const { ctx, respond } = ctxFor('contractor')
    respond({ data: null, error: { message: 'boom' } })
    await expect(maskRows('projects', 'tenders', [{ id: 't', project_id: P1, stated_total: 1 }], ctx)).rejects.toThrow()
  })
})

describe('assertFilterableColumns', () => {
  it('a filter on a masked column is refused for a contractor and allowed for an owner', () => {
    const contractor = ctxFor('contractor').ctx
    expect(() => assertFilterableColumns('projects', 'projects', ['contract_value'], contractor)).toThrow(ToolRefusal)
    expect(() => assertFilterableColumns('projects', 'projects', ['name', 'contract_value'], contractor)).toThrow(MASKED_COLUMN)
    expect(() => assertFilterableColumns('projects', 'projects', ['contract_value'], ctxFor('owner').ctx)).not.toThrow()
  })
  it('an unmasked column is always allowed', () => {
    expect(() => assertFilterableColumns('projects', 'projects', ['name', 'id'], ctxFor('contractor').ctx)).not.toThrow()
    expect(() => assertFilterableColumns('inspections', 'responses', ['value_number'], ctxFor('contractor').ctx)).not.toThrow()
  })
})

describe('maskRpcResult', () => {
  it('nulls masked names recursively for a contractor only', () => {
    const input = { total: [{ rate: 1, name: 'x', nested: { contract_value: 9, keep: 2 } }], rate: 3 }
    const out = maskRpcResult(input, ctxFor('contractor').ctx)
    expect(out.result).toEqual({ total: [{ rate: null, name: 'x', nested: { contract_value: null, keep: 2 } }], rate: null })
    expect(out.maskedColumns.sort()).toEqual(['contract_value', 'rate'])
    expect(input.total[0].rate).toBe(1)
    const owner = maskRpcResult(input, ctxFor('owner').ctx)
    expect(owner).toEqual({ result: input, maskedColumns: [] })
  })
  it('passes scalars and null through', () => {
    const ctx = ctxFor('contractor').ctx
    expect(maskRpcResult(5, ctx)).toEqual({ result: 5, maskedColumns: [] })
    expect(maskRpcResult(null, ctx)).toEqual({ result: null, maskedColumns: [] })
  })
})
