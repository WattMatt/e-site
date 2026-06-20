import { describe, it, expect } from 'vitest'
import { shouldAdvanceToOrdered } from './order-status-advance'

describe('shouldAdvanceToOrdered', () => {
  it('advances a required order when an order-instruction is uploaded', () => {
    expect(shouldAdvanceToOrdered('order_instruction', 'required')).toBe(true)
  })

  it('does NOT advance for a quote (pricing only)', () => {
    expect(shouldAdvanceToOrdered('quote', 'required')).toBe(false)
  })

  it('does NOT touch orders past required, or tenant-supplied orders', () => {
    expect(shouldAdvanceToOrdered('order_instruction', 'ordered')).toBe(false)
    expect(shouldAdvanceToOrdered('order_instruction', 'received')).toBe(false)
    expect(shouldAdvanceToOrdered('order_instruction', 'by_tenant')).toBe(false)
  })
})
