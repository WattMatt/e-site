/**
 * WinAnsi (CP1252) text sanitiser for PDF standard fonts.
 *
 * Both PDF renderers in this repo use the standard-14 Helvetica, which can only
 * encode the WinAnsi character set. The two libraries fail differently, and the
 * quiet one is the dangerous one:
 *
 *   • pdf-lib (cable-schedule exports) THROWS. That is how the revision-pack PDF
 *     500'd on every download from 2026-05-13 to 2026-07-31 (the `Ω/km` column
 *     header), and how the tag renderers crashed on `→`.
 *
 *   • @react-pdf/renderer (lib/reports/*) does NOT throw — it truncates the code
 *     point to its low byte and renders whatever WinAnsi character that lands
 *     on. Measured 2026-08-13: `✓` U+2713 → 0x13 (invisible control),
 *     `◐` U+25D0 → `Ð`, `○` U+25CB → `Ë`, `→` U+2192 → `’`. A report can
 *     therefore ship a client a deliverable with silently wrong glyphs and no
 *     error anywhere. `·` U+00B7, `—` U+2014, `²` and `°` are genuinely safe.
 *
 * User-controlled strings (project names, board names, order notes) can carry
 * anything, so every drawn string must pass through here.
 *
 * Strategy, per character:
 *   1. WinAnsi-encodable → keep.
 *   2. Known technical symbol → readable ASCII replacement (Ω → Ohm, → → ->).
 *   3. NFKD-decomposable → transliterate (strip combining marks, expand
 *      ligatures) when the result is encodable.
 *   4. Otherwise → '?' (never throw).
 *
 * Whitespace (`collapseWhitespace`) is the ONE thing the two renderers must not
 * share. See the option's own comment on winAnsiSafe — collapsing is a pdf-lib
 * constraint, not a property of WinAnsi, and applying it on the react-pdf path
 * flattens every multi-line answer into one run-on paragraph.
 */

/** Unicode code points that map into WinAnsi's 0x80–0x9F slots. */
const WINANSI_EXTRA = new Set([
  '€', '‚', 'ƒ', '„', '…', '†', '‡',
  'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž', '‘',
  '’', '“', '”', '•', '–', '—', '˜',
  '™', 'š', '›', 'œ', 'ž', 'Ÿ',
])

/** Readable replacements for symbols engineers actually type. */
const REPLACEMENTS: Record<string, string> = {
  '\u03A9': 'Ohm', // greek capital omega
  '\u2126': 'Ohm', // ohm sign (NFKC-normalises to U+03A9, kept for safety)
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '−': '-', // minus sign
  '≤': '<=',
  '≥': '>=',
  '≈': '~',
  '√': 'sqrt',
  'Δ': 'delta', // Δ greek capital delta
  '∆': 'delta', // ∆ increment
}

export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)
}

/**
 * True when every character survives a standard-font PDF render unchanged.
 * Used by report contract tests: react-pdf will not raise on a bad glyph, so the
 * only way to catch one is to assert on the strings before they are drawn.
 */
export function isWinAnsiSafe(text: string): boolean {
  return [...text].every(isWinAnsi)
}

export interface WinAnsiSafeOptions {
  /**
   * Fold `\n`, `\r` and `\t` to a single space. Defaults to TRUE, which is the
   * behaviour every pdf-lib call site needs and must keep.
   *
   * This is a **pdf-lib constraint, not a WinAnsi one**: `widthOfTextAtSize`
   * THROWS on a newline (even though `drawText` would line-split it), and every
   * pdf-lib call site is single-line by construction because multi-line text is
   * put through `wrapText` BEFORE it is sanitised. A pasted newline in a tag or
   * board name must not 500 the export.
   *
   * @react-pdf/renderer has no such constraint — `<Text>` line-breaks on `\n`
   * natively — so the report renderers pass `false`. Collapsing there would
   * flatten every multi-line answer (18 textarea fields on the site form alone:
   * scope_description, extent_and_limitations, parts_not_covered, …) into one
   * run-on paragraph: a second silent-corruption bug of exactly the shape this
   * module exists to prevent, since something still renders and nothing throws.
   */
  collapseWhitespace?: boolean
}

export function winAnsiSafe(text: string, opts?: WinAnsiSafeOptions): string {
  const collapseWhitespace = opts?.collapseWhitespace ?? true
  let out = ''
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += collapseWhitespace ? ' ' : ch
      continue
    }
    if (isWinAnsi(ch)) {
      out += ch
      continue
    }
    const mapped = REPLACEMENTS[ch]
    if (mapped != null) {
      out += mapped
      continue
    }
    const decomposed = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    if (decomposed === '') continue // bare combining mark — drop
    if ([...decomposed].every(isWinAnsi)) {
      out += decomposed
      continue
    }
    out += '?'
  }
  return out
}
