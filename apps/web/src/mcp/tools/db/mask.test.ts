import { describe, it, expect } from 'vitest'
import { fakeClient } from '../../test/fake-client'
import { ToolRefusal, type ToolContext } from '../../define-tool'
import { MASKED_COLUMN } from './sentences'
import { hasCostRoleEverywhere, maskedColumnsOf, assertFilterableColumns, maskRows, maskRpcResult, maskWrittenRows, ownerKeyOf } from './mask'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

const WM = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const OWN = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'

function ctxFor(role: string, memberships?: Array<{ organisationId: string; role: string }>) {
  const f = fakeClient()
  const ctx = { client: f.client, user: { id: 'u1' }, claims: {}, memberships: memberships ?? [{ organisationId: WM, role }] } as unknown as ToolContext
  return { ...f, ctx }
}
// A contractor on WM projects who owns a company org of their own.
const contractorWhoOwnsAnOrg = () => ctxFor('contractor', [{ organisationId: WM, role: 'contractor' }, { organisationId: OWN, role: 'owner' }])

// An owner of their own org who is a contractor on one WM project: the org half passes, the project half does not.
function ownerWhoIsAProjectContractor() {
  const f = ctxFor('owner', [{ organisationId: OWN, role: 'owner' }])
  f.respond({ data: [{ role: 'contractor' }] })
  return f
}

describe('hasCostRoleEverywhere', () => {
  it('is false with no membership and false when any membership is a site role, without reading projects', async () => {
    const none = ctxFor('owner', [])
    expect(await hasCostRoleEverywhere(none.ctx)).toBe(false)
    expect(none.calls).toEqual([])
    const mixed = contractorWhoOwnsAnOrg()
    expect(await hasCostRoleEverywhere(mixed.ctx)).toBe(false)
    expect(mixed.calls).toEqual([])
    expect(await hasCostRoleEverywhere(ctxFor('owner', [{ organisationId: WM, role: 'owner' }, { organisationId: OWN, role: 'admin' }]).ctx)).toBe(true)
  })
  it('is true for owner, admin and project_manager and false for site roles', async () => {
    for (const r of ['owner', 'admin', 'project_manager']) expect(await hasCostRoleEverywhere(ctxFor(r).ctx), r).toBe(true)
    for (const r of ['contractor', 'inspector', 'supplier', 'client_viewer']) expect(await hasCostRoleEverywhere(ctxFor(r).ctx), r).toBe(false)
  })
  it('reads the person\'s active project memberships through their own client', async () => {
    const { ctx, calls, respond } = ctxFor('owner')
    respond({ data: [{ role: 'project_manager' }, { role: 'admin' }] })
    expect(await hasCostRoleEverywhere(ctx)).toBe(true)
    expect(calls).toEqual([
      { path: 'projects.project_members', method: 'select', args: ['role'] },
      { path: 'projects.project_members', method: 'eq', args: ['user_id', 'u1'] },
      { path: 'projects.project_members', method: 'eq', args: ['is_active', true] },
    ])
  })
  it('an org owner who is a contractor on one project is not cost-everywhere; with no project rows they are', async () => {
    expect(await hasCostRoleEverywhere(ownerWhoIsAProjectContractor().ctx)).toBe(false)
    const clean = ctxFor('owner', [{ organisationId: OWN, role: 'owner' }])
    clean.respond({ data: [] })
    expect(await hasCostRoleEverywhere(clean.ctx)).toBe(true)
  })
  it('a project-rows query error is treated as not cost-everywhere', async () => {
    const { ctx, respond } = ctxFor('owner')
    respond({ data: null, error: { message: 'boom' } })
    expect(await hasCostRoleEverywhere(ctx)).toBe(false)
  })
  it('reads the project rows once per context', async () => {
    const { ctx, calls, respond } = ctxFor('owner')
    respond({ data: [{ role: 'contractor' }] })
    expect(await hasCostRoleEverywhere(ctx)).toBe(false)
    expect(await hasCostRoleEverywhere(ctx)).toBe(false)
    expect(calls.filter(c => c.method === 'select')).toHaveLength(1)
  })
})

describe('ownerKeyOf', () => {
  it('is the project key, else organisation_id when the table has one, else null', () => {
    expect(ownerKeyOf('projects', 'projects')).toBe('id')
    expect(ownerKeyOf('projects', 'tenders')).toBe('project_id')
    expect(ownerKeyOf('billing', 'invoices')).toBe('organisation_id')
    expect(ownerKeyOf('projects', 'boq_items')).toBeNull()
    expect(ownerKeyOf('inspections', 'responses')).toBeNull()
  })
})

describe('maskedColumnsOf', () => {
  it('lists the masked columns of a table and nothing for an unmasked one', () => {
    expect(maskedColumnsOf('projects', 'projects')).toContain('contract_value')
    expect(maskedColumnsOf('inspections', 'responses')).toEqual([])
  })
})

describe('maskRows', () => {
  it('an owner sees every column unchanged, the project role still being asked for', async () => {
    const { ctx, calls, respond } = ctxFor('owner')
    respond({ data: 'owner' })
    const rows = [{ id: P1, contract_value: 100 }]
    const out = await maskRows('projects', 'projects', rows, ctx)
    expect(out.rows).toEqual([{ id: P1, contract_value: 100 }])
    expect(out.maskedColumns).toEqual([])
    expect(calls.map(c => c.path)).toEqual(['rpc:user_effective_project_role'])
  })

  it('an owner of one org is masked on a project where their effective role is a site role', async () => {
    const { ctx, respond } = ctxFor('owner')
    respond({ data: 'client_viewer' })
    expect((await maskRows('projects', 'projects', [{ id: P1, contract_value: 100 }], ctx)).rows[0].contract_value).toBeNull()
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
    const owner = ctxFor('owner')
    owner.respond({ data: 'owner' }); owner.respond({ data: 'owner' })
    expect((await maskRows('projects', 'tenders', rows, owner.ctx)).rows.map(r => r.stated_total)).toEqual([100, 200, 300])
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

  it('projects.projects is judged by the row id as the project', async () => {
    const { ctx, calls, respond } = ctxFor('contractor')
    respond({ data: 'project_manager' })
    respond({ data: 'contractor' })
    const out = await maskRows('projects', 'projects', [{ id: P1, contract_value: 100 }, { id: P2, contract_value: 200 }], ctx)
    expect(out.rows.map(r => r.contract_value)).toEqual([100, null])
    expect(calls.filter(c => c.path === 'rpc:user_effective_project_role').map(c => c.args[0])).toEqual([{ p_project_id: P1, p_user_id: 'u1' }, { p_project_id: P2, p_user_id: 'u1' }])
  })

  it('a contractor on WM who is owner of a second org still has WM rows masked by the row project', async () => {
    const { ctx, respond } = contractorWhoOwnsAnOrg()
    respond({ data: 'contractor' })
    const rows = [{ id: 't1', project_id: P1, stated_total: 100 }]
    const out = await maskRows('projects', 'tenders', rows, ctx)
    expect(out.rows[0].stated_total).toBeNull()
    expect(out.maskedColumns).toEqual(['stated_total'])
    // control: a single-org owner is unchanged (the project role comes back 'owner')
    const owner = ctxFor('owner')
    owner.respond({ data: 'owner' })
    expect(await maskRows('projects', 'tenders', rows, owner.ctx)).toEqual({ rows, maskedColumns: [] })
  })

  it('without a project, the row organisation_id decides', async () => {
    const { ctx, calls } = contractorWhoOwnsAnOrg()
    const rows = [
      { id: 'i1', organisation_id: WM, amount_kobo: 100 },
      { id: 'i2', organisation_id: OWN, amount_kobo: 200 },
      { id: 'i3', organisation_id: '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', amount_kobo: 300 },
    ]
    const out = await maskRows('billing', 'invoices', rows, ctx)
    expect(out.rows.map(r => r.amount_kobo)).toEqual([null, 200, null])
    expect(calls).toEqual([])
  })

  it('without a project or organisation, a mixed-role person is masked and an everywhere-cost person is not', async () => {
    const rows = [{ id: 'r1', rate: 3 }]
    expect((await maskRows('projects', 'boq_items', rows, contractorWhoOwnsAnOrg().ctx)).rows[0].rate).toBeNull()
    const both = ctxFor('owner', [{ organisationId: WM, role: 'owner' }, { organisationId: OWN, role: 'project_manager' }])
    expect((await maskRows('projects', 'boq_items', rows, both.ctx)).rows[0].rate).toBe(3)
  })

  it('a project-keyed row without its key column is masked, whatever the caller holds elsewhere, and no lookup is made', async () => {
    const rows = [{ id: 't1', organisation_id: WM, stated_total: 100 }]
    for (const who of [contractorWhoOwnsAnOrg(), ctxFor('owner'), ctxFor('contractor')]) {
      const out = await maskRows('projects', 'tenders', rows, who.ctx)
      expect(out.rows[0].stated_total).toBeNull()
      expect(who.calls).toEqual([])
    }
    // projects.projects is keyed on id: contract_value selected without id is masked too
    const owner = ctxFor('owner')
    expect((await maskRows('projects', 'projects', [{ contract_value: 5 }], owner.ctx)).rows[0].contract_value).toBeNull()
    expect(owner.calls).toEqual([])
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

  it('boq_items rates are null for an org owner who is a contractor on a project, and shown with no project rows', async () => {
    const rows = [{ id: 'r1', rate: 3 }]
    expect((await maskRows('projects', 'boq_items', rows, ownerWhoIsAProjectContractor().ctx)).rows[0].rate).toBeNull()
    const clean = ctxFor('owner', [{ organisationId: OWN, role: 'owner' }])
    clean.respond({ data: [] })
    expect((await maskRows('projects', 'boq_items', rows, clean.ctx)).rows[0].rate).toBe(3)
  })

  it('a role lookup error refuses rather than showing the figure', async () => {
    const { ctx, respond } = ctxFor('contractor')
    respond({ data: null, error: { message: 'boom' } })
    await expect(maskRows('projects', 'tenders', [{ id: 't', project_id: P1, stated_total: 1 }], ctx)).rejects.toThrow()
  })
})

describe('assertFilterableColumns', () => {
  it('a filter on a masked column is refused for a contractor and allowed for an owner', async () => {
    const contractor = ctxFor('contractor').ctx
    await expect(assertFilterableColumns('projects', 'projects', ['contract_value'], contractor)).rejects.toThrow(ToolRefusal)
    await expect(assertFilterableColumns('projects', 'projects', ['name', 'contract_value'], contractor)).rejects.toThrow(MASKED_COLUMN)
    await expect(assertFilterableColumns('projects', 'projects', ['contract_value'], ctxFor('owner').ctx)).resolves.toBeUndefined()
  })
  it('a contractor who owns a second org still cannot filter on a masked column', async () => {
    await expect(assertFilterableColumns('projects', 'projects', ['contract_value'], contractorWhoOwnsAnOrg().ctx)).rejects.toThrow(MASKED_COLUMN)
  })
  it('an org owner who is a contractor on one project cannot filter on a masked column', async () => {
    await expect(assertFilterableColumns('projects', 'projects', ['contract_value'], ownerWhoIsAProjectContractor().ctx)).rejects.toThrow(MASKED_COLUMN)
  })
  it('an unmasked column is always allowed', async () => {
    await expect(assertFilterableColumns('projects', 'projects', ['name', 'id'], ctxFor('contractor').ctx)).resolves.toBeUndefined()
    await expect(assertFilterableColumns('inspections', 'responses', ['value_number'], ctxFor('contractor').ctx)).resolves.toBeUndefined()
  })
})

describe('maskRpcResult', () => {
  it('nulls masked names recursively for a contractor only', async () => {
    const input = { total: [{ rate: 1, name: 'x', nested: { contract_value: 9, keep: 2 } }], rate: 3 }
    const out = await maskRpcResult(input, ctxFor('contractor').ctx)
    expect(out.result).toEqual({ total: [{ rate: null, name: 'x', nested: { contract_value: null, keep: 2 } }], rate: null })
    expect(out.maskedColumns.sort()).toEqual(['contract_value', 'rate'])
    expect(input.total[0].rate).toBe(1)
    const owner = await maskRpcResult(input, ctxFor('owner').ctx)
    expect(owner).toEqual({ result: input, maskedColumns: [] })
  })
  it('still masks for a contractor who owns a second org', async () => {
    const out = await maskRpcResult([{ rate: 1 }], contractorWhoOwnsAnOrg().ctx)
    expect(out.result).toEqual([{ rate: null }])
    expect(out.maskedColumns).toEqual(['rate'])
  })
  it('masks for an org owner who is a contractor on one project', async () => {
    expect(await maskRpcResult([{ rate: 1 }], ownerWhoIsAProjectContractor().ctx)).toEqual({ result: [{ rate: null }], maskedColumns: ['rate'] })
  })
  it('passes scalars and null through', async () => {
    const ctx = ctxFor('contractor').ctx
    expect(await maskRpcResult(5, ctx)).toEqual({ result: 5, maskedColumns: [] })
    expect(await maskRpcResult(null, ctx)).toEqual({ result: null, maskedColumns: [] })
  })
})

describe('maskWrittenRows', () => {
  it('a role lookup error nulls every masked column instead of throwing; the same rows are shown when the lookup works', async () => {
    const rows = [{ id: 't1', project_id: P1, stated_total: 100, title: 'x' }]
    const failing = ctxFor('owner')
    failing.respond({ data: null, error: { message: 'boom' } })
    expect(await maskWrittenRows('projects', 'tenders', rows, failing.ctx))
      .toEqual({ rows: [{ id: 't1', project_id: P1, stated_total: null, title: 'x' }], maskedColumns: ['stated_total'] })
    const working = ctxFor('owner')
    working.respond({ data: 'owner' })
    expect(await maskWrittenRows('projects', 'tenders', rows, working.ctx)).toEqual({ rows, maskedColumns: [] })
  })
})
