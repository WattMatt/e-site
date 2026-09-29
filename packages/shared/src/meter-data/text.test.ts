import { describe, it, expect } from 'vitest'
import { decodeMeterText, splitLines, splitRow } from './text'
import { isUsable, QUALITY } from './types'

describe('decodeMeterText', () => {
  it('reads UTF-8 and reports CRLF', () => {
    const d = decodeMeterText(new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n'))
    expect(d).toEqual({ text: 'sep=,\r\n\r\ndate,p14\r\n', encoding: 'utf-8', lineEnding: 'crlf' })
  })
  it('strips a BOM', () => {
    const d = decodeMeterText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a]))
    expect(d.text).toBe('a\n')
    expect(d.encoding).toBe('utf-8-bom')
    expect(d.lineEnding).toBe('lf')
  })
  it('falls back to Windows-1252 for invalid UTF-8', () => {
    const d = decodeMeterText(new Uint8Array([0x43, 0x41, 0x46, 0xc9]))  // "CAFÉ" in latin1
    expect(d.encoding).toBe('latin1')
    expect(d.text).toBe('CAFÉ')
  })
})

describe('splitLines', () => {
  it('splits CRLF and LF and drops one trailing empty line', () => {
    expect(splitLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c'])
    expect(splitLines('a\r\n\r\nb')).toEqual(['a', '', 'b'])
  })
})

describe('splitRow', () => {
  it('handles PnP "comma plus space" with quoted headers', () => {
    expect(splitRow('"P (per kW)", "Q (per kvar)", "DATE"', ',')).toEqual(['P (per kW)', 'Q (per kvar)', 'DATE'])
    expect(splitRow('332.26, 126.94, 2025-10-01, 00:30:00, Ok', ',')).toEqual(['332.26', '126.94', '2025-10-01', '00:30:00', 'Ok'])
  })
  it('keeps a quoted delimiter and unescapes doubled quotes', () => {
    expect(splitRow('TENANT-22,"SHOP 040,04B,L4,L007B",440', ',')).toEqual(['TENANT-22', 'SHOP 040,04B,L4,L007B', '440'])
    expect(splitRow('"a ""b""",c', ',')).toEqual(['a "b"', 'c'])
  })
  it('keeps empty cells', () => {
    expect(splitRow(',,', ',')).toEqual(['', '', ''])
  })
})

describe('isUsable', () => {
  it('encodes the usability rule', () => {
    expect(isUsable({ value: 1, quality: QUALITY.OK })).toBe(true)
    expect(isUsable({ value: 1, quality: QUALITY.ESTIMATED })).toBe(true)
    expect(isUsable({ value: 0.001, quality: QUALITY.SCALE_CORRECTED })).toBe(true)
    expect(isUsable({ value: 0, quality: QUALITY.NEGATIVE })).toBe(true)        // clamped tiny negative
    expect(isUsable({ value: -1710.82, quality: QUALITY.NEGATIVE })).toBe(false) // large negative: shown, excluded
    expect(isUsable({ value: null, quality: QUALITY.MISSING })).toBe(false)
    expect(isUsable({ value: 59000, quality: QUALITY.SPIKE })).toBe(false)
    expect(isUsable({ value: 5, quality: QUALITY.DUPLICATE })).toBe(false)
    expect(isUsable({ value: 5, quality: QUALITY.STATUS })).toBe(false)
  })
})
