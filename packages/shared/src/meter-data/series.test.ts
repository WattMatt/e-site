import { describe, it, expect } from 'vitest'
import { detectCumulative, detectIntervalMin, detectRowOrder, normaliseSeries, parseNumericCell, type RawRow } from './series'
import { QUALITY, type ChannelSpec } from './types'

const KW: ChannelSpec = { sourceColumn: 'p14', columnIndex: 1, quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', unitFromTable: true }
const KWH: ChannelSpec = { ...KW, sourceColumn: 'P1 (kWh)', quantity: 'active_energy', sourceUnit: 'kWh' }
const T0 = Date.UTC(2025, 2, 9, 22, 0)   // 2025-03-10 00:00 SAST
const M30 = 30 * 60_000
const row = (i: number, v: string, status: string | null = null, fileIndex = i): RawRow => ({ labelUtcMs: T0 + i * M30, cells: [v], status, fileIndex })

describe('helpers', () => {
  it('row order', () => {
    expect(detectRowOrder([1, 2, 3])).toBe('ascending')
    expect(detectRowOrder([3, 2, 1])).toBe('descending')
    expect(detectRowOrder([3, 1, 2])).toBe('unordered')
  })
  it('interval = mode of Δt', () => {
    expect(detectIntervalMin([0, M30, 2 * M30, 4 * M30, 5 * M30])).toBe(30)
    expect(detectIntervalMin([0])).toBeNull()
  })
  it('numeric cells; decimal comma only when told', () => {
    expect(parseNumericCell('12.5', false)).toBe(12.5)
    expect(parseNumericCell('12,5', true)).toBe(12.5)
    expect(parseNumericCell('12,5', false)).toBeNull()
    expect(parseNumericCell('', false)).toBeNull()
    expect(parseNumericCell('1.5e3', false)).toBe(1500)
    expect(parseNumericCell('abc', false)).toBeNull()
  })
})

describe('normaliseSeries', () => {
  it('interval-beginning labels are stored at label + Δ; rows re-sorted', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(2, '3'), row(1, '2'), row(0, '1')], convention: 'begin', statusMode: 'none' })
    expect(r.rowOrder).toBe('descending')
    expect(r.intervalMin).toBe(30)
    expect(r.channels[0].readings.map((x) => [x.tsEnd, x.value])).toEqual([[T0 + M30, 1], [T0 + 2 * M30, 2], [T0 + 3 * M30, 3]])
  })
  it('interval-ending labels are stored as is', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(1, '1'), row(2, '2')], convention: 'end', statusMode: 'none' })
    expect(r.channels[0].readings[0].tsEnd).toBe(T0 + M30)
  })
  it('absent rows become NULL slots (never 0)', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(0, '1'), row(1, '2'), row(4, '5')], convention: 'end', statusMode: 'none' })
    expect(r.intervalMin).toBe(30)   // Δt 30 and 90 tie once each; the shorter wins
    expect(r.channels[0].readings.map((x) => [x.value, x.quality])).toEqual([[1, 0], [2, 0], [null, 1], [null, 1], [5, 0]])
  })
  it('duplicate timestamps: first kept; conflicting values flag 5', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(0, '1'), row(1, '2', null, 1), row(1, '9', null, 2), row(2, '3')], convention: 'end', statusMode: 'none' })
    expect(r.duplicates).toBe(1)
    expect(r.channels[0].readings[1]).toMatchObject({ value: 2, quality: QUALITY.DUPLICATE })
  })
  it('PnP B: Calc 0 → missing; other Calc → estimated; unknown status → 6', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(0, '0.0', 'Calc'), row(1, '5.5', 'Calc'), row(2, '6', 'Ok'), row(3, '7', 'Odd')], convention: 'end', statusMode: 'pnp_b' })
    expect(r.channels[0].readings.map((x) => [x.value, x.quality])).toEqual([[null, 1], [5.5, 2], [6, 0], [7, 6]])
    expect(r.calcRows).toBe(2)
  })
  it('PnP C: status 0 → ok, anything else → 6 (value kept)', () => {
    const r = normaliseSeries({ channels: [KWH], rows: [row(0, '1', '0'), row(1, '1', '2048')], convention: 'end', statusMode: 'pnp_c' })
    expect(r.channels[0].readings.map((x) => x.quality)).toEqual([0, 6])
    expect(r.statusRows).toBe(1)
  })
  it('energy per 30 min is stored as kW (× 2)', () => {
    const r = normaliseSeries({ channels: [KWH], rows: [row(0, '4.82'), row(1, '4.13')], convention: 'end', statusMode: 'none' })
    expect(r.channels[0].readings.map((x) => x.value)).toEqual([9.64, 8.26])
    expect(r.channels[0].storedUnit).toBe('kW')
  })
  it('daily files are coverage-only', () => {
    const D = 86_400_000
    const r = normaliseSeries({ channels: [KW], rows: [0, 1, 2].map((i) => ({ labelUtcMs: T0 + i * D, cells: ['100'], status: null, fileIndex: i })), convention: 'end', statusMode: 'none' })
    expect(r.intervalMin).toBe(1440)
    expect(r.channels[0].coverageOnly).toBe(true)
  })
  it('fewer than two distinct rows is an error', () => {
    expect(() => normaliseSeries({ channels: [KW], rows: [row(0, '1')], convention: 'end', statusMode: 'none' })).toThrow(/too_few_rows|at least two/)
  })
})

describe('cumulative registers', () => {
  const register = [...Array(30).keys()].map((i) => 1000 + i * 2)
  // 51 values → 50 steps, exactly one decreasing: 49 / 50 = 0.98 (the threshold is inclusive).
  const withRollover = [...register, ...[...Array(21).keys()].map((i) => 5 + i * 2)]
  it('detected over ALL rows (≥ 98 % non-decreasing, median step ≪ level)', () => {
    expect(detectCumulative(withRollover.map((v, i) => ({ tsEnd: i, value: v, quality: 0 as const })))).toBe(true)
    expect(detectCumulative(Array(60).fill(0.01).map((v, i) => ({ tsEnd: i, value: v, quality: 0 as const })))).toBe(false)
  })
  it('converted to deltas: first row missing, the rollover shown as quality 4', () => {
    const r = normaliseSeries({ channels: [KWH], rows: withRollover.map((v, i) => row(i, String(v))), convention: 'end', statusMode: 'none' })
    const ch = r.channels[0]
    expect(ch.isCumulative).toBe(true)
    expect(ch.readings[0]).toMatchObject({ value: null, quality: QUALITY.MISSING })
    expect(ch.readings[1].value).toBe(4)                                 // 2 kWh per 30 min = 4 kW
    expect(ch.readings[30]).toMatchObject({ value: null, quality: QUALITY.SPIKE })
    expect(ch.stats.rollovers).toBe(1)
  })
})
