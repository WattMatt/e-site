import { describe, it, expect } from 'vitest'
import { emptyHistory, pushHistory, undoHistory, redoHistory, HISTORY_LIMIT } from './layout-history'

describe('snapshot history', () => {
  it('push / undo / redo, with a no-change push ignored and redo discarded on a new push', () => {
    let h = emptyHistory([1])
    h = pushHistory(h, [1])
    expect(h.canUndo).toBe(false)
    h = pushHistory(h, [1, 2])
    h = pushHistory(h, [1, 2, 3])
    h = undoHistory(h)
    expect(h.present).toEqual([1, 2])
    expect(h.canRedo).toBe(true)
    h = redoHistory(h)
    expect(h.present).toEqual([1, 2, 3])
    h = undoHistory(undoHistory(h))
    h = pushHistory(h, [9])
    expect(h.canRedo).toBe(false)
    expect(h.past).toEqual([[1]])
  })
  it('is bounded', () => {
    let h = emptyHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i)
    expect(h.past.length).toBe(HISTORY_LIMIT)
  })
})
