import { describe, it, expect } from 'vitest'
import { jsonUnsafePath } from './json-safe'

describe('jsonUnsafePath', () => {
  it('accepts plain JSON', () => {
    expect(jsonUnsafePath({ a: 1, b: 'x', c: null, d: [true, { e: -0.5 }] })).toBeNull()
  })
  it('names the path of a function', () => {
    expect(jsonUnsafePath({ a: { onSave: () => 1 } })).toBe('$.a.onSave')
  })
  it('rejects undefined, NaN and Infinity', () => {
    expect(jsonUnsafePath({ a: undefined })).toBe('$.a')
    expect(jsonUnsafePath({ a: [1, Number.NaN] })).toBe('$.a[1]')
    expect(jsonUnsafePath({ a: Infinity })).toBe('$.a')
  })
  it('rejects Map, Set and Date', () => {
    expect(jsonUnsafePath({ m: new Map() })).toBe('$.m')
    expect(jsonUnsafePath({ s: new Set() })).toBe('$.s')
    expect(jsonUnsafePath({ d: new Date(0) })).toBe('$.d')
  })
})
