import { describe, it, expect } from 'vitest'
import { classifySheet } from './classify-sheet'

const HDR_SI = ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'SUPPLY', 'INSTALL', 'AMOUNT']
const HDR_SINGLE = ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT']

describe('classifySheet', () => {
  it('detects a supply/install bill sheet + column map', () => {
    const r = classifySheet('1.3 Low Voltage', [
      ['KINGSWALK'],
      [],
      HDR_SI,
      ['C1.1', '4C', 'm', 446, 628.3, 18, 288249.8],
    ])
    expect(r.kind).toBe('bill')
    expect(r.headerRowIndex).toBe(2)
    expect(r.columns).toMatchObject({ item: 0, description: 1, unit: 2, qty: 3, supply: 4, install: 5, amount: 6 })
    expect(r.rateModel).toBe('supply_install')
  })

  it('detects a single-rate bill sheet', () => {
    const r = classifySheet('P&G', [[], HDR_SINGLE, ['A1', 'x', 'Sum', null, null, 1139424]])
    expect(r.kind).toBe('bill')
    expect(r.rateModel).toBe('single')
    expect(r.columns.rate).toBe(4)
  })

  it('detects a summary sheet by name', () => {
    expect(
      classifySheet('Main Summary', [['ITEM', 'DESCRIPTION'], ['1', 'MALL', null, null, null, 37184510.62]]).kind,
    ).toBe('summary')
  })

  it('detects a prose sheet by name', () => {
    expect(
      classifySheet('NOTES TO TENDERER', [['(643) KINGSWALK'], ['NOTES TO TENDERER']]).kind,
    ).toBe('prose')
  })

  it('normalises ITEA → ITEM header noise', () => {
    const r = classifySheet('1.1 Test', [
      ['ITEA', 'DESCRIPTION', 'UNIT', 'QTY', 'SUPPLY RATE', 'INSTALL RATE', 'AMOUNT'],
    ])
    expect(r.kind).toBe('bill')
    expect(r.columns).toMatchObject({ item: 0, description: 1, supply: 4, install: 5 })
    expect(r.rateModel).toBe('supply_install')
  })

  it('falls back to amount_only when neither RATE nor SUPPLY/INSTALL present', () => {
    const r = classifySheet('1.2 Allowances', [['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'AMOUNT']])
    expect(r.kind).toBe('bill')
    expect(r.rateModel).toBe('amount_only')
  })

  it('detects QUALIFICATIONS as prose', () => {
    expect(classifySheet('QUALIFICATIONS', [['some text']]).kind).toBe('prose')
  })
})
