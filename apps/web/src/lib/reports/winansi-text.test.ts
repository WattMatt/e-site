import { describe, it, expect } from 'vitest'
import { toWinAnsiSafe, toWinAnsiSafeOptional } from './winansi-text'

/**
 * Code points, never literals. A test whose input can be laundered by an
 * editor, a linter or a git filter is a test that passes for the wrong reason —
 * and this whole class of bug is "passes for the wrong reason".
 */
const OHM_GREEK = String.fromCharCode(0x03a9) // Ω GREEK CAPITAL LETTER OMEGA
const OHM_SIGN = String.fromCharCode(0x2126) // Ω OHM SIGN
const LE = String.fromCharCode(0x2264) // ≤
const GE = String.fromCharCode(0x2265) // ≥
const NE = String.fromCharCode(0x2260) // ≠
const RARR = String.fromCharCode(0x2192) // →
const LARR = String.fromCharCode(0x2190) // ←
const TICK = String.fromCharCode(0x2713) // ✓
const CROSS = String.fromCharCode(0x2717) // ✗
const HEAVY_CROSS = String.fromCharCode(0x2718) // ✘
const WARNING = String.fromCharCode(0x26a0) // ⚠
const MINUS = String.fromCharCode(0x2212) // − MINUS SIGN
const INCREMENT = String.fromCharCode(0x2206) // ∆ (the template's I∆n label)
const MU_GREEK = String.fromCharCode(0x03bc) // μ GREEK SMALL LETTER MU
const MICRO = String.fromCharCode(0x00b5) // µ MICRO SIGN — genuine WinAnsi
const ELLIPSIS = String.fromCharCode(0x2026) // … — genuine WinAnsi (0x85)

describe('toWinAnsiSafe — technical symbols', () => {
  it('spells out the ohm sign in both of its code points', () => {
    // Both forms occur in the wild: keyboards emit U+03A9, some CAD exports
    // and older documents emit U+2126.
    expect(toWinAnsiSafe(`M${OHM_GREEK}`)).toBe('MOhm')
    expect(toWinAnsiSafe(`M${OHM_SIGN}`)).toBe('MOhm')
    expect(toWinAnsiSafe(`0,2 ${OHM_GREEK}`)).toBe('0,2 Ohm')
  })

  it('converts the comparison operators', () => {
    expect(toWinAnsiSafe(`${LE} 0 V`)).toBe('<= 0 V')
    expect(toWinAnsiSafe(`${GE} 1,0`)).toBe('>= 1,0')
    expect(toWinAnsiSafe(`A ${NE} B`)).toBe('A != B')
  })

  it('converts arrows and the increment sign', () => {
    expect(toWinAnsiSafe(`MB ${RARR} DB-67`)).toBe('MB -> DB-67')
    expect(toWinAnsiSafe(`DB-67 ${LARR} MB`)).toBe('DB-67 <- MB')
    // U+2206 silently rendered as an invisible control character before the fix.
    expect(toWinAnsiSafe(`I${INCREMENT}n`)).toBe('Ideltan')
  })

  it('converts ticks, crosses and the warning sign to words a reader can act on', () => {
    expect(toWinAnsiSafe(TICK)).toBe('Yes')
    expect(toWinAnsiSafe(CROSS)).toBe('No')
    expect(toWinAnsiSafe(HEAVY_CROSS)).toBe('No')
    expect(toWinAnsiSafe(`${WARNING} check`)).toBe('! check')
  })

  it('converts the minus sign and Greek mu', () => {
    expect(toWinAnsiSafe(`${MINUS}5`)).toBe('-5')
    // Greek mu is NOT encodable (it drew as ¼); the micro sign IS, and it means
    // exactly the same thing, so the unit survives as a unit.
    expect(toWinAnsiSafe(`50 ${MU_GREEK}F`)).toBe(`50 ${MICRO}F`)
  })
})

describe('toWinAnsiSafe — characters that are already WinAnsi', () => {
  it('passes genuine WinAnsi characters through untouched', () => {
    // Over-sanitising is its own bug: these all render correctly as themselves,
    // and `mm2`, `65 degC` or `50 uF` on a compliance record is a regression.
    const safe = `2,5 mm² · 65 °C † ‡ • — – ‘ ’ “ ” £ € ½ ¼ × ± café ü ${MICRO}F ${ELLIPSIS}`
    expect(toWinAnsiSafe(safe)).toBe(safe)
  })

  it('passes plain ASCII through untouched', () => {
    expect(toWinAnsiSafe('DB-1 / way 12 (as found)')).toBe('DB-1 / way 12 (as found)')
    expect(toWinAnsiSafe('')).toBe('')
  })
})

describe('toWinAnsiSafe — fallbacks', () => {
  it('transliterates via NFKD when it can', () => {
    expect(toWinAnsiSafe('é')).toBe('e') // decomposed e + combining acute
    expect(toWinAnsiSafe('ﬁle')).toBe('file')
  })

  it('emits a visible ? for anything with no sensible transliteration', () => {
    // A `?` is honest. A silent `©` is not — that is the entire bug.
    expect(toWinAnsiSafe('中文')).toBe('??')
    expect(toWinAnsiSafe('🚀')).toBe('?')
  })
})

describe('toWinAnsiSafe — whitespace', () => {
  it('PRESERVES line breaks and tabs', () => {
    // The pdf-lib path collapses these because widthOfTextAtSize throws on a
    // newline. react-pdf has no such constraint, and collapsing here would
    // flatten all 18 textarea answers on the site form into run-on paragraphs.
    expect(toWinAnsiSafe('Line one\nLine two')).toBe('Line one\nLine two')
    expect(toWinAnsiSafe('a\r\nb\tc')).toBe('a\r\nb\tc')
  })

  it('still sanitises glyphs on every line of a multi-line value', () => {
    expect(toWinAnsiSafe(`0,2 ${OHM_GREEK}\n${LE} 1 s`)).toBe('0,2 Ohm\n<= 1 s')
  })
})

describe('toWinAnsiSafeOptional', () => {
  it('preserves nullish, so "no value" keeps styling as absent', () => {
    expect(toWinAnsiSafeOptional(null)).toBeNull()
    expect(toWinAnsiSafeOptional(undefined)).toBeUndefined()
    expect(toWinAnsiSafeOptional('')).toBe('')
  })

  it('sanitises a real string', () => {
    expect(toWinAnsiSafeOptional(`0,2 ${OHM_GREEK}`)).toBe('0,2 Ohm')
  })
})
