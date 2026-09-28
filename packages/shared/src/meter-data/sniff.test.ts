import { describe, it, expect } from 'vitest'
import { sniffMeterText } from './sniff'
import { decodeMeterText } from './text'
import { fixture, registerFixture } from './__fixtures__/load'

const sniffFixture = (id: string) => sniffMeterText(decodeMeterText(fixture(id).bytes).text)

describe('sniffMeterText on the golden fixtures', () => {
  it.each([
    ['a-bulk', 'A'], ['a-pv-multi', 'A'], ['a-water', 'A'],
    ['b-virtual-calc', 'B'], ['b-daily', 'B'], ['b-seven-serials', 'B'],
    ['c-energy', 'C'], ['c-energy-2', 'C'],
    ['d-escaped', 'D'], ['e-log', 'E'], ['f-derived', 'F'],
  ])('%s → %s', (id, fmt) => {
    expect(sniffFixture(id).format).toBe(fmt)
  })

  it('A: header on line 3, data from line 4', () => {
    expect(sniffFixture('a-bulk')).toMatchObject({ delimiter: ',', headerLineIndex: 2, dataStartIndex: 3 })
  })
  it('A with only "sep=," is an empty file', () => {
    expect(sniffFixture('a-empty')).toMatchObject({ format: 'empty', reason: 'empty_file' })
  })
  it('B carries every line-1 serial', () => {
    expect(sniffFixture('b-virtual-calc').serials).toHaveLength(3)
    expect(sniffFixture('b-seven-serials').serials).toHaveLength(7)
    expect(sniffFixture('b-misfiled').serials).toHaveLength(1)
  })
  it('C: header line 2, one serial', () => {
    expect(sniffFixture('c-energy')).toMatchObject({ headerLineIndex: 1, dataStartIndex: 2 })
    expect(sniffFixture('c-energy').serials).toHaveLength(1)
  })
  it('G: both summary shapes', () => {
    const nine = sniffMeterText(decodeMeterText(registerFixture('SITE YA_Consolidation_Summary.9col.csv').bytes).text)
    const three = sniffMeterText(decodeMeterText(registerFixture('SITE YA_Consolidation_Summary.csv').bytes).text)
    expect([nine.format, three.format]).toEqual(['G', 'G'])
  })
})

describe('sniffMeterText edge cases', () => {
  it('whitespace only → empty', () => {
    expect(sniffMeterText(' \r\n\r\n').format).toBe('empty')
  })
  it('A header but no data → header_only', () => {
    expect(sniffMeterText('sep=,\r\n\r\ndate,p14\r\n')).toMatchObject({ format: 'empty', reason: 'header_only' })
  })
  it('PnP C header only → header_only', () => {
    expect(sniffMeterText('pnpscada.com,30000001\nTime,P1 (kWh),Status\n')).toMatchObject({ format: 'empty', reason: 'header_only' })
  })
  it('PnP preamble unquoted but B header → B (an .xlsx sheet written back to CSV)', () => {
    const t = 'pnpscada.com,30000002\n"P (per kW)","DATE","TIME","STATUS"\n1,2025-03-10,00:30:00,Ok\n'
    expect(sniffMeterText(t).format).toBe('B')
  })
  it('generic: semicolon + decimal comma picks ";"', () => {
    const t = 'Timestamp;Import (kW)\n01/02/2025 00:30;12,5\n01/02/2025 01:00;13,0\n01/02/2025 01:30;13,5\n01/02/2025 02:00;14,0\n01/02/2025 02:30;14,5\n'
    expect(sniffMeterText(t)).toMatchObject({ format: 'generic', delimiter: ';', headerLineIndex: 0, dataStartIndex: 1 })
  })
  it('generic without a header → no_header', () => {
    expect(sniffMeterText('1,2\n3,4\n')).toMatchObject({ format: 'generic', reason: 'no_header' })
  })
})
