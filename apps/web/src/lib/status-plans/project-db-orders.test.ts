// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { loadProjectDbOrderStatus } from './project-db-orders'

const ARGS = { projectId: 'p-1', orgId: 'org-1' }

describe('loadProjectDbOrderStatus', () => {
  it('maps every node with a DB order to its status, main boards included', async () => {
    const { client, calls } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: [{ id: 'st-db' }] }],
      'structure.node_orders:select': [{ data: [
        { id: 'o1', node_id: 'n-tenant', status: 'ordered' },
        { id: 'o2', node_id: 'n-main', status: 'received' },
      ] }],
    }))
    expect(await loadProjectDbOrderStatus(client, ARGS)).toEqual({ 'n-tenant': 'ordered', 'n-main': 'received' })

    expect(opsOf(calls, 'structure.scope_item_types')).toEqual(expect.arrayContaining([
      ['eq', ['organisation_id', 'org-1']], ['eq', ['key', 'db']],
    ]))
    const orders = opsOf(calls, 'structure.node_orders')
    expect(orders).toContainEqual(['eq', ['project_id', 'p-1']])
    expect(orders).toContainEqual(['in', ['scope_item_type_id', ['st-db']]])
    expect(orders).toContainEqual(['order', ['id']])
    expect(orders).toContainEqual(['range', [0, 999]])
  })

  it('returns nothing, and reads no orders, when the org has no DB scope type', async () => {
    const { client, calls } = fakeClient(queued({ 'structure.scope_item_types:select': [{ data: [] }] }))
    expect(await loadProjectDbOrderStatus(client, ARGS)).toEqual({})
    expect(calls.map((c) => c.table)).not.toContain('structure.node_orders')
  })

  it('pages past the 1 000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `o${i}`, node_id: `n${i}`, status: 'required' }))
    const { client, calls } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: [{ id: 'st-db' }] }],
      'structure.node_orders:select': [{ data: page1 }, { data: [{ id: 'o1000', node_id: 'n1000', status: 'by_tenant' }] }],
    }))
    const out = await loadProjectDbOrderStatus(client, ARGS)
    expect(Object.keys(out)).toHaveLength(1001)
    expect(out.n1000).toBe('by_tenant')
    expect(calls.filter((c) => c.table === 'structure.node_orders')).toHaveLength(2)
  })

  it('throws a named error when a read fails, rather than showing every block as unordered', async () => {
    const { client } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: [{ id: 'st-db' }] }],
      'structure.node_orders:select': [{ error: { message: 'boom' } }],
    }))
    await expect(loadProjectDbOrderStatus(client, ARGS)).rejects.toThrow(/DB orders: boom/)
  })
})
