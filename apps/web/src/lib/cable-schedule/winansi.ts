/**
 * WinAnsi (CP1252) text sanitiser for pdf-lib standard fonts.
 *
 * pdf-lib's built-in Helvetica can only encode the WinAnsi character set;
 * any other character makes drawText/widthOfTextAtSize THROW — which is how
 * the revision-pack PDF 500'd on every download from 2026-05-13 to
 * 2026-07-31 (the `Ω/km` column header), and the tag renderers crashed on
 * `→` whenever a revision had tags. User-controlled strings (project names,
 * tag text, notes) can carry anything, so every drawn string must pass
 * through here.
 *
 * Strategy, per character:
 *   1. WinAnsi-encodable → keep.
 *   2. Known technical symbol → readable ASCII replacement (Ω → Ohm, → → ->).
 *   3. NFKD-decomposable → transliterate (strip combining marks, expand
 *      ligatures) when the result is encodable.
 *   4. Otherwise → '?' (never throw).
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

function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)
}

export function winAnsiSafe(text: string): string {
  let out = ''
  for (const ch of text) {
    // Whitespace controls become spaces: widthOfTextAtSize throws on \n/\r
    // even though drawText would line-split them, and every call site in
    // the renderers is single-line (multi-line text goes through wrapText
    // BEFORE sanitising). A pasted newline in a tag or board name must not
    // 500 the export.
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += ' '
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
