import { describe, it, expect } from 'vitest'
import { SYMBOLS, SYMBOL_KINDS } from './markup-symbols'

describe('symbol registry', () => {
  it('exposes the expected electrical set', () => {
    expect(SYMBOL_KINDS).toEqual(
      expect.arrayContaining(['db', 'socket', 'switch', 'luminaire', 'isolator', 'earth', 'conduit', 'motor']),
    )
  })

  it('every symbol has a label and at least one drawing element', () => {
    for (const kind of SYMBOL_KINDS) {
      const def = SYMBOLS[kind]
      expect(def.label.length, kind).toBeGreaterThan(0)
      expect(def.els.length, kind).toBeGreaterThan(0)
    }
  })

  it('every element is well-formed within the 0..100 box', () => {
    for (const kind of SYMBOL_KINDS) {
      for (const el of SYMBOLS[kind].els) {
        if (el.t === 'line') {
          expect(el.pts.length % 2, kind).toBe(0)
          expect(el.pts.length, kind).toBeGreaterThanOrEqual(4)
          expect(Math.max(...el.pts), kind).toBeLessThanOrEqual(100)
          expect(Math.min(...el.pts), kind).toBeGreaterThanOrEqual(0)
        } else if (el.t === 'circle') {
          expect(el.r, kind).toBeGreaterThan(0)
        } else if (el.t === 'path') {
          expect(el.d.length, kind).toBeGreaterThan(0)
        } else {
          expect(el.s.length, kind).toBeGreaterThan(0)
        }
      }
    }
  })
})
