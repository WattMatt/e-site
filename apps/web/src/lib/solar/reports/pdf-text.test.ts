import { describe, it, expect } from 'vitest'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import { pdfText } from './pdf-text'

describe('pdfText (react-pdf path)', () => {
  it('spells out the symbols react-pdf would silently corrupt', () => {
    expect(pdfText('Rinsul ≤ 0,2 Ω ✓ → next ✗')).toBe('Rinsul <= 0,2 Ohm Yes -> next No')
  })
  it('keeps WinAnsi-safe punctuation and units untouched', () => {
    expect(pdfText('500 kWp · 12 m² · 25 °C — “quoted”')).toBe('500 kWp · 12 m² · 25 °C — “quoted”')
  })
  it('keeps newlines (react-pdf line-breaks natively; collapsing them is a pdf-lib rule)', () => {
    expect(pdfText('line 1\nline 2')).toBe('line 1\nline 2')
  })
  it('always returns WinAnsi-safe text, and is idempotent', () => {
    const hostile = 'Δ√≈ ✔✘ 漢字 😀 ≥'
    expect(isWinAnsiSafe(pdfText(hostile).replace(/\n/g, ''))).toBe(true)
    expect(pdfText(pdfText(hostile))).toBe(pdfText(hostile))
  })
})
