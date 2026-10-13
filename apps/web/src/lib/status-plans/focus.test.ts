import { describe, it, expect } from 'vitest'
import { FOCUS_BLINK_MS, FOCUS_FILL, FOCUS_PULSE_MS, focusPending, pulseVisible } from './focus'

describe('pulseVisible', () => {
  it('blinks on/off every FOCUS_BLINK_MS for FOCUS_PULSE_MS, starting on', () => {
    expect(FOCUS_PULSE_MS).toBe(2000)
    expect(FOCUS_FILL).toBe(0.6)
    expect(pulseVisible(0)).toBe(true)
    expect(pulseVisible(FOCUS_BLINK_MS - 1)).toBe(true)
    expect(pulseVisible(FOCUS_BLINK_MS)).toBe(false)
    expect(pulseVisible(2 * FOCUS_BLINK_MS)).toBe(true)
  })
  it('is off after the pulse and for nonsense', () => {
    expect(pulseVisible(FOCUS_PULSE_MS)).toBe(false)
    expect(pulseVisible(-1)).toBe(false)
    expect(pulseVisible(Number.NaN)).toBe(false)
  })
})

describe('focusPending', () => {
  it('is pending for a new nonce once the image is there', () => {
    expect(focusPending(null, { nonce: 1 }, true)).toBe(true)
    expect(focusPending(1, { nonce: 2 }, true)).toBe(true)
  })
  it('is not pending without a focus, without the image, or once that nonce was fitted', () => {
    expect(focusPending(null, null, true)).toBe(false)
    expect(focusPending(null, { nonce: 1 }, false)).toBe(false)
    expect(focusPending(1, { nonce: 1 }, true)).toBe(false)
  })
})
