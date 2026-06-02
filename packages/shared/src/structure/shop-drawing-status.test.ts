import { describe, it, expect } from 'vitest'
import { type ShopDrawingStatus, nextStatus, prevStatus, canAdvanceTo } from './shop-drawing-status'

describe('shop-drawing-status', () => {
  it('advances forward awaiting → received → approved', () => {
    expect(nextStatus('awaiting')).toBe('received')
    expect(nextStatus('received')).toBe('approved')
    expect(nextStatus('approved')).toBeNull()
  })

  it('steps backward approved → received → awaiting', () => {
    expect(prevStatus('approved')).toBe('received')
    expect(prevStatus('received')).toBe('awaiting')
    expect(prevStatus('awaiting')).toBeNull()
  })

  it('canAdvanceTo enforces single-step forward moves only', () => {
    expect(canAdvanceTo('awaiting', 'received')).toBe(true)
    expect(canAdvanceTo('received', 'approved')).toBe(true)
    expect(canAdvanceTo('awaiting', 'approved')).toBe(false)
    expect(canAdvanceTo('received', 'received')).toBe(false)
  })
})
