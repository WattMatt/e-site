import { describe, it, expect } from 'vitest'
import { dbBlockStatus, DB_BLOCK_STATUS_LABEL } from './db-block-status'

describe('dbBlockStatus', () => {
  it('an unlinked block is unlinked whatever order is passed', () => {
    expect(dbBlockStatus(false, null)).toBe('unlinked')
    expect(dbBlockStatus(false, 'received')).toBe('unlinked')
  })
  it('a linked block with no DB order row (e.g. a main board) is no_order', () => {
    expect(dbBlockStatus(true, null)).toBe('no_order')
  })
  it.each(['required', 'ordered', 'received', 'by_tenant'] as const)('a linked block shows its DB order: %s', (s) => {
    expect(dbBlockStatus(true, s)).toBe(s)
  })
  it('has a label for every status', () => {
    expect(DB_BLOCK_STATUS_LABEL).toEqual({
      required: 'Required',
      ordered: 'Ordered',
      received: 'Received',
      by_tenant: 'By tenant',
      no_order: 'No DB order',
      unlinked: 'Unlinked',
    })
  })
})
