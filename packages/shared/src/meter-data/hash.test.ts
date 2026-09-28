import { describe, it, expect } from 'vitest'
import { canonicalBody, sha256Hex } from './hash'
import type { RawRow } from './series'
import type { ChannelSpec } from './types'

const P: ChannelSpec = { sourceColumn: 'P (per kW)', columnIndex: 0, quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', unitFromTable: true }

describe('sha256Hex', () => {
  it('matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('canonicalBody', () => {
  const rows: RawRow[] = [
    { labelUtcMs: 2, cells: ['0.0'], status: 'Calc', fileIndex: 0 },
    { labelUtcMs: 1, cells: ['332.2599999997765'], status: 'Ok', fileIndex: 1 },
  ]
  it('is independent of row order, preamble and numeric spelling', () => {
    const a = canonicalBody([P], rows)
    const b = canonicalBody([{ ...P, sourceColumn: 'P (per kW) ' }], [{ ...rows[1], fileIndex: 0 }, { ...rows[0], cells: ['0'], fileIndex: 1 }])
    expect(a).toBe(b)
    expect(a.split('\n')[0]).toBe('active_power:import::kW')
  })
  it('changes when a value changes', () => {
    expect(canonicalBody([P], rows)).not.toBe(canonicalBody([P], [{ ...rows[0], cells: ['0.1'] }, rows[1]]))
  })
})
