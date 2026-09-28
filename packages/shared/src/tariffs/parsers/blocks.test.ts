import { describe, expect, it } from 'vitest'
import { parseBlockRange, repairBlocks } from './blocks'
import { makeCharge } from '../types'

describe('parseBlockRange', () => {
  it.each([
    ['Block 1 (0-350kWh)', 0, 350],
    ['Block 2 (501-1000kWh)', 501, 1000],
    ['Block 5 (>3000kWh)', 3000, null],
    ['Block 1 (0 to 50 kWh)', 0, 50],
    ['Block 2 (>50 to <=600 kWh)', 50, 600],
    ['Block 2 (51 – 350 kWh)', 51, 350],
    ['(0-50kWh)', 0, 50],
    ['Part 1 - First 50 kWh. Charge per kWh', 0, 50],
    ["Part 2 - Charge per kWh >2000 kWh's purchased (c/kWh)", 2000, null],
    ['Block 1 (<300)kWh', 0, 300],
    ['Block 2 (300 - 700)kWh', 300, 700],
  ] as const)('%s', (text, min, max) => {
    expect(parseBlockRange(text)).toMatchObject({ min, max, typo: false })
  })
  it('flags the "500Wh" typo', () => {
    expect(parseBlockRange('Block 3 (>500Wh)')).toEqual({ min: 500, max: null, typo: true })
  })
  it('finds no block in a label without a range', () => {
    for (const s of ['Peak', 'Part 2 - Charge per kWh (c/kWh)', 'Energy charge: R/kWh', 'Single rate energy charge']) {
      expect(parseBlockRange(s)).toBeNull()
    }
  })
})

describe('repairBlocks', () => {
  const b = (min: number | null, max: number | null) =>
    makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 1, blockMinKwh: min, blockMaxKwh: max, blockBasis: min === null ? null : 'monthly' })
  it('closes "0-500 / 501-1000" to a 500 boundary', () => {
    const cs = [b(0, 500), b(501, 1000), b(1001, null)]
    repairBlocks(cs)
    expect(cs.map((c) => [c.blockMinKwh, c.blockMaxKwh])).toEqual([[0, 500], [500, 1000], [1000, null]])
  })
  it('gives an unranged middle part the gap between its neighbours (Buffalo City Scale 1C)', () => {
    const cs = [b(0, 50), b(null, null), b(300, null)]
    repairBlocks(cs)
    expect(cs.map((c) => [c.blockMinKwh, c.blockMaxKwh, c.blockBasis])).toEqual([[0, 50, 'monthly'], [50, 300, 'monthly'], [300, null, 'monthly']])
  })
})
