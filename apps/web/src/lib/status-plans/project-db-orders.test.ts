// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { boardOrderStatusByNode, loadProjectDbOrderStatus } from './project-db-orders'

const ARGS = { projectId: 'p-1', orgId: 'org-1' }

const TYPES = [{ id: 'st-db', key: 'db' }, { id: 'st-lt', key: 'lighting' }]
const NODES = [
  { id: 'n-tenant', kind: 'tenant_db' },
  { id: 'n-main', kind: 'main_board' },
  { id: 'n-mini', kind: 'mini_sub' },
  { id: 'n-bare', kind: 'generator' },
]

describe('loadProjectDbOrderStatus', () => {
  it('colours equipment boards from their untyped board line and tenant boards from their DB line', async () => {
    const { client, calls } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: TYPES }],
      'structure.nodes:select': [{ data: NODES }],
      'structure.node_orders:select': [{ data: [
        { id: 'o1', node_id: 'n-tenant', label: 'DB', scope_item_type_id: 'st-db', status: 'ordered' },
        { id: 'o2', node_id: 'n-tenant', label: 'Lighting', scope_item_type_id: 'st-lt', status: 'received' },
        { id: 'o3', node_id: 'n-main', label: 'MB 1.1', scope_item_type_id: null, status: 'received' },
        { id: 'o4', node_id: 'n-mini', label: 'MS 2', scope_item_type_id: null, status: 'ordered' },
      ] }],
    }))
    expect(await loadProjectDbOrderStatus(client, ARGS)).toEqual({
      'n-tenant': 'ordered',
      'n-main': 'received',
      'n-mini': 'ordered',
      'n-bare': 'required',
    })

    expect(opsOf(calls, 'structure.scope_item_types')).toContainEqual(['eq', ['organisation_id', 'org-1']])
    const nodes = opsOf(calls, 'structure.nodes')
    expect(nodes).toContainEqual(['eq', ['project_id', 'p-1']])
    expect(nodes).toContainEqual(['is', ['deleted_at', null]])
    const orders = opsOf(calls, 'structure.node_orders')
    expect(orders).toContainEqual(['eq', ['project_id', 'p-1']])
    expect(orders).not.toContainEqual(expect.arrayContaining(['in']))
    // schedule order: label, then id as the tie-break readAll needs
    expect(orders.filter(([m]) => m === 'order')).toEqual([['order', ['label']], ['order', ['id']]])
    expect(orders).toContainEqual(['range', [0, 999]])
  })

  it('a tenant board without a DB line has no entry (drawn as no order)', async () => {
    const { client } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: TYPES }],
      'structure.nodes:select': [{ data: [{ id: 'n-tenant', kind: 'tenant_db' }] }],
      'structure.node_orders:select': [{ data: [
        { id: 'o2', node_id: 'n-tenant', label: 'Lighting', scope_item_type_id: 'st-lt', status: 'received' },
      ] }],
    }))
    expect(await loadProjectDbOrderStatus(client, ARGS)).toEqual({})
  })

  it('pages past the 1 000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `o${i}`, node_id: `n${i}`, label: `L${i}`, scope_item_type_id: null, status: 'ordered' }))
    const nodes = Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}`, kind: 'main_board' }))
    const { client, calls } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: TYPES }],
      'structure.nodes:select': [{ data: nodes.slice(0, 1000) }, { data: nodes.slice(1000) }],
      'structure.node_orders:select': [{ data: page1 }, { data: [{ id: 'o1000', node_id: 'n1000', label: 'L1000', scope_item_type_id: null, status: 'by_tenant' }] }],
    }))
    const out = await loadProjectDbOrderStatus(client, ARGS)
    expect(Object.keys(out)).toHaveLength(1001)
    expect(out.n1000).toBe('by_tenant')
    expect(calls.filter((c) => c.table === 'structure.node_orders')).toHaveLength(2)
    expect(calls.filter((c) => c.table === 'structure.nodes')).toHaveLength(2)
  })

  it.each(['structure.scope_item_types', 'structure.nodes', 'structure.node_orders'])(
    'throws a named error when %s fails, rather than showing every block as unordered', async (t) => {
      const { client } = fakeClient(queued({
        'structure.scope_item_types:select': [{ data: TYPES }],
        'structure.nodes:select': [{ data: NODES }],
        'structure.node_orders:select': [{ data: [] }],
        [`${t}:select`]: [{ error: { message: 'boom' } }],
      }))
      await expect(loadProjectDbOrderStatus(client, ARGS)).rejects.toThrow(/DB orders: boom/)
    },
  )
})

describe('boardOrderStatusByNode', () => {
  it('ignores orders on nodes it was not given (deleted boards)', () => {
    expect(boardOrderStatusByNode({
      nodes: [],
      orders: [{ node_id: 'gone', scope_item_type_id: null, status: 'received' }],
      scopeKeyById: new Map(),
    })).toEqual({})
  })
})
