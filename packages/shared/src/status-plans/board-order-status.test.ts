import { describe, it, expect } from 'vitest'
import { boardOrderStatus, type BoardOrderLine } from './board-order-status'

const line = (scopeKey: string | null, status: BoardOrderLine['status']): BoardOrderLine => ({ scopeKey, status })

describe('boardOrderStatus — tenant boards', () => {
  it('a tenant board shows its DB line', () => {
    expect(boardOrderStatus({ kind: 'tenant_db', lines: [line('lighting', 'received'), line('db', 'ordered')] })).toBe('ordered')
  })
  it('a tenant board with no DB line has no order, whatever its other lines say', () => {
    expect(boardOrderStatus({ kind: 'tenant_db', lines: [line('lighting', 'received'), line(null, 'received')] })).toBeNull()
    expect(boardOrderStatus({ kind: 'tenant_db', lines: [] })).toBeNull()
  })
})

describe('boardOrderStatus — equipment boards (mirrors the Equipment & Materials schedule)', () => {
  it.each(['main_board', 'mini_sub', 'rmu', 'common_area_board', 'generator', 'custom'])(
    'a %s takes the status of its untyped board line', (kind) => {
      expect(boardOrderStatus({ kind, lines: [line(null, 'received')] })).toBe('received')
    },
  )
  it('an equipment board with no line is still a buy-list item: required', () => {
    expect(boardOrderStatus({ kind: 'main_board', lines: [] })).toBe('required')
  })
  it('several lines: the first in schedule order (label, then id) wins, as the schedule summary does', () => {
    expect(boardOrderStatus({ kind: 'main_board', lines: [line(null, 'ordered'), line(null, 'required')] })).toBe('ordered')
  })
  it('a DB-typed line on an equipment board does not make it a tenant board', () => {
    expect(boardOrderStatus({ kind: 'main_board', lines: [line('db', 'by_tenant')] })).toBe('by_tenant')
  })
})
