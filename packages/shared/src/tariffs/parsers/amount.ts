import { parseUnitToken } from '../units'
import type { CellValue } from './grid'

export interface ParsedAmount {
  value: number
  /** Text after the number ("c/kWh", "/month"), or null. */
  unitText: string | null
  /** Written with a leading "R" (so a bare "/kWh" is rand). */
  randPrefix: boolean
  raw: string
}

/** "1 184,45" / "1,6464" / "1,787.81" → number. A single comma + 1-4 digits is a decimal comma. */
export function parseNumberText(s: string): number | null {
  let t = s.replace(/\s/g, '')
  if (!/^\d[\d,.]*$/.test(t)) return null
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '')
  else if (/^\d+,\d{1,4}$/.test(t)) t = t.replace(',', '.')
  else if (t.includes(',')) return null
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

const AMOUNT = /^(R\s?)?(\d[\d ]*(?:[.,]\d+)?)\s*(.*)$/i

/** A cell or label tail holding one price. The tail, when present, must be a unit. */
export function parseAmount(raw: CellValue): ParsedAmount | null {
  if (raw === null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, unitText: null, randPrefix: false, raw: String(raw) } : null
  const s = raw.replace(/\s+/g, ' ').trim()
  const m = AMOUNT.exec(s)
  if (!m) return null
  const value = parseNumberText(m[2])
  if (value === null) return null
  const tail = m[3].trim()
  const randPrefix = m[1] !== undefined
  if (tail !== '' && parseUnitToken(tail, { randPrefix, bare: true }) === null) return null
  return { value, unitText: tail === '' ? null : tail, randPrefix, raw: s }
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

/** Row 1 of a province sheet: "NAME - x%", "NAME (x%)", or the % (text or fraction) in B1. */
export function parseTitle(a1: CellValue, b1: CellValue): { name: string; increasePct: number | null } {
  const text = typeof a1 === 'string' ? a1.replace(/\s+/g, ' ').trim() : ''
  const inA = /(\d+(?:[.,]\d+)?)\s*%/.exec(text)
  let pct: number | null = inA ? Number(inA[1].replace(',', '.')) : null
  if (pct === null && b1 !== null) {
    if (typeof b1 === 'number') {
      pct = b1 > 0 && b1 < 1 ? round4(b1 * 100) : b1
    } else {
      const inB = /(\d+(?:[.,]\d+)?)\s*%/.exec(b1)
      if (inB) pct = Number(inB[1].replace(',', '.'))
      else {
        const n = parseNumberText(b1)
        if (n !== null) pct = n > 0 && n < 1 ? round4(n * 100) : n
      }
    }
  }
  const name = text
    .replace(/\s*[-|]?\s*\(?\s*\d+(?:[.,]\d+)?\s*%\s*\)?\s*$/, '')
    .replace(/\s*[-|]\s*$/, '')
    .trim()
  return { name, increasePct: pct }
}
