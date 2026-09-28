import { describe, expect, it } from 'vitest'
import { parseAmount, parseNumberText, parseTitle } from './amount'

describe('parseNumberText', () => {
  it.each([
    ['1 184,45', 1184.45], ['1,6464', 1.6464], ['1,787.81', 1787.81], ['227.28', 227.28], ['110,00', 110],
  ])('%s -> %s', (s, v) => expect(parseNumberText(s)).toBe(v))
  it('refuses a thousands comma it cannot read as a decimal', () => {
    expect(parseNumberText('1,000,000')).toBeNull()
  })
})

describe('parseAmount', () => {
  it.each([
    ['R1 184,45', 1184.45, null, true],
    ['R 202,25 /month', 202.25, '/month', true],
    ['214.46c/kWh', 214.46, 'c/kWh', false],
    ['R1,6464/kWh', 1.6464, '/kWh', true],
    ['R346.49//kVA', 346.49, '//kVA', true],
    ['R157.91 R/kVA', 157.91, 'R/kVA', true],
    ['R0.00A/kVA NMD/Month', 0, 'A/kVA NMD/Month', true],
    ['288.86 c/kWh', 288.86, 'c/kWh', false],
    ['R358,84', 358.84, null, true],
  ] as const)('%s', (raw, value, unitText, randPrefix) => {
    expect(parseAmount(raw)).toMatchObject({ value, unitText, randPrefix })
  })
  it('passes numbers through', () => {
    expect(parseAmount(227.28)).toMatchObject({ value: 227.28, unitText: null })
  })
  it('refuses text that is not an amount', () => {
    for (const s of ['Redundant tariff', '(0-50kWh)', '2024/25 Recommended', '-', 'Approved c/kWh', 'kWh']) {
      expect(parseAmount(s)).toBeNull()
    }
  })
})

describe('parseTitle', () => {
  it.each([
    ['City Power - 12.72%', null, 'City Power', 12.72],
    ['Gamagara Local Municipality (7.71%)', null, 'Gamagara Local Municipality', 7.71],
    ['Maluti a Phofung (10,00%)', null, 'Maluti a Phofung', 10],
    ['BUFFALO CITY - 11%', null, 'BUFFALO CITY', 11],
    ['City of Ekurhuleni', '12.74%', 'City of Ekurhuleni', 12.74],
    ['LEPHALALE', 0.1039, 'LEPHALALE', 10.39],
    ['DAMPLAAS', null, 'DAMPLAAS', null],
  ] as const)('%s | %s', (a1, b1, name, pct) => {
    expect(parseTitle(a1, b1)).toEqual({ name, increasePct: pct })
  })
})
