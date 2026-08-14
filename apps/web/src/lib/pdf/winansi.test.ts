import { describe, it, expect } from 'vitest'
import { winAnsiSafe } from './winansi'

describe('winAnsiSafe', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(winAnsiSafe('MAIN BOARD 3.1-DB-78A 400V x1')).toBe(
      'MAIN BOARD 3.1-DB-78A 400V x1',
    )
  })

  it('keeps CP1252-encodable extended characters', () => {
    // Latin-1 accents, degree, superscript-2, middle dot, multiplication
    // sign, em-dash, ellipsis and curly quote are all WinAnsi-encodable.
    expect(winAnsiSafe('café ü ° ² · × — … ’')).toBe('café ü ° ² · × — … ’')
  })

  it('replaces Ω with Ohm (the schedule header crash, 2026-07-31)', () => {
    expect(winAnsiSafe('Ω/km')).toBe('Ohm/km')
  })

  it('replaces → with -> (the tag-card crash, 2026-07-31)', () => {
    expect(winAnsiSafe('MB → DB-67')).toBe('MB -> DB-67')
  })

  it('replaces common technical symbols readably', () => {
    expect(winAnsiSafe('−5 ≤ x ≥ 3')).toBe('-5 <= x >= 3')
  })

  it('transliterates decomposable characters via NFKD', () => {
    // e + combining acute (decomposed) → e; fi-ligature → fi
    expect(winAnsiSafe('e\u0301')).toBe('e') // decomposed e + combining acute
    expect(winAnsiSafe('ﬁle')).toBe('file')
  })

  it('falls back to ? for unencodable characters instead of throwing', () => {
    expect(winAnsiSafe('中文')).toBe('??')
    expect(winAnsiSafe('🚀')).toBe('?')
  })

  it('handles empty and mixed strings', () => {
    expect(winAnsiSafe('')).toBe('')
    expect(winAnsiSafe('DB-Ω→中')).toBe('DB-Ohm->?')
  })

  it('converts newlines/CR/tabs to spaces — widthOfTextAtSize throws on them', () => {
    expect(winAnsiSafe('DB-01\nA')).toBe('DB-01 A')
    expect(winAnsiSafe('a\r\nb\tc')).toBe('a  b c')
  })
})

/**
 * `collapseWhitespace` is asserted in BOTH directions on purpose.
 *
 * Only testing the react-pdf direction would let a later "simplification" that
 * deletes the whitespace branch outright go green — the newline survives, the
 * new test passes — while silently changing behaviour for every pdf-lib caller,
 * which is the exact regression the default exists to prevent. One test guards
 * the new path; it takes both to guard the flag.
 */
describe('winAnsiSafe — collapseWhitespace', () => {
  const INPUT = 'Line one\nLine two'

  it('collapses by default — the pdf-lib direction', () => {
    // Every existing pdf-lib call site relies on this: widthOfTextAtSize THROWS
    // on a newline, and those renderers wrap BEFORE they sanitise.
    expect(winAnsiSafe(INPUT)).toBe('Line one Line two')
    expect(winAnsiSafe(INPUT, {})).toBe('Line one Line two')
    expect(winAnsiSafe(INPUT, { collapseWhitespace: true })).toBe('Line one Line two')
    expect(winAnsiSafe('a\r\nb\tc', { collapseWhitespace: true })).toBe('a  b c')
  })

  it('preserves when asked — the react-pdf direction', () => {
    // <Text> line-breaks on \n natively; collapsing flattens multi-line answers.
    expect(winAnsiSafe(INPUT, { collapseWhitespace: false })).toBe(INPUT)
    expect(winAnsiSafe('a\r\nb\tc', { collapseWhitespace: false })).toBe('a\r\nb\tc')
  })

  it('sanitises glyphs identically whichever way whitespace goes', () => {
    const ohm = String.fromCharCode(0x03a9)
    expect(winAnsiSafe(`0,2 ${ohm}\nx`, { collapseWhitespace: true })).toBe('0,2 Ohm x')
    expect(winAnsiSafe(`0,2 ${ohm}\nx`, { collapseWhitespace: false })).toBe('0,2 Ohm\nx')
  })
})
