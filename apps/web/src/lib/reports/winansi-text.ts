/**
 * winansi-text.ts — the react-pdf side of the WinAnsi problem.
 *
 * @react-pdf/renderer draws with the standard-14 Helvetica, which can only
 * encode WinAnsi (CP1252). Unlike pdf-lib it does NOT throw on anything else:
 * it truncates the code point to its low byte and draws whatever WinAnsi
 * character that lands on. Measured on 2026-08-13 by rendering a probe page and
 * inflating its content stream:
 *
 *   INPUT : A[MΩ]B[≤]C[mm²]D[65 °C]E[†]F[·]G[∆]H[µ]I[μ]
 *   OUTPUT: A[M©]B[d]C[mm²]D[65 °C]E[†]F[·]G[ ]H[µ]I[¼]
 *
 * So `Ω` drew as `©`, `≤` drew as the letter `d`, `∆` vanished into an
 * invisible control character, and Greek `μ` drew as `¼`. `mm²`, `°`, `†`, `·`
 * and the micro sign `µ` (U+00B5) are genuine WinAnsi code points and are safe.
 *
 * That shipped: the seeded site-form template carries six `Ω` units, a `≤` in
 * the proving-dead label and an `I∆n` label, so a SANS 10142-1 record printed
 * `≤ 0,2 Ω` as `d 0,2 ©` on a legal compliance document — with no error
 * anywhere, which is why it survived two renderer test suites.
 *
 * The transliteration table and the encoding table live in @/lib/pdf/winansi,
 * shared with the pdf-lib exporters — deliberately ONE table, because two would
 * drift and only one of them would be the one anybody remembered to fix.
 *
 * The one thing this path does NOT share is whitespace handling: pdf-lib folds
 * `\n` to a space because `widthOfTextAtSize` throws on it, while react-pdf's
 * <Text> line-breaks natively. Collapsing here would flatten all 18 textarea
 * answers on the site form into run-on paragraphs — the same shape of silent
 * corruption, so `collapseWhitespace: false` is not an optimisation, it is the
 * point.
 */

import { winAnsiSafe } from '@/lib/pdf/winansi'

/**
 * Symbols that reach a REPORT but never a cable-schedule export, so they are
 * mapped here rather than widening the shared table.
 *
 * Every entry is a character that is NOT WinAnsi-encodable. Nothing that IS
 * encodable appears here: over-sanitising is its own bug, and `² ³ ° · µ — –
 * … † ‡ • £ € ½ ×` all render correctly as themselves.
 */
const REPORT_REPLACEMENTS: Record<string, string> = {
  // Tick / cross — used as answer values by inspection-style templates. Words,
  // not punctuation: a lone 'Y' beside a question is not an answer a reader can
  // rely on in an enquiry.
  '✓': 'Yes', // ✓
  '✔': 'Yes', // ✔
  '✗': 'No', // ✗
  '✘': 'No', // ✘
  '⚠': '!', // ⚠ warning sign
  '≠': '!=', // ≠
  // Greek mu → the WinAnsi MICRO SIGN, not the letter 'u'. `µF` and `µs` are
  // the units an electrician actually writes; U+00B5 is encodable and carries
  // the meaning exactly, so it beats transliterating to ASCII. (U+00B5 itself
  // is left alone — it already renders correctly.)
  'μ': 'µ', // μ U+03BC → µ U+00B5
}

/**
 * Make a caller- or template-supplied string safe to draw with a react-pdf
 * standard font, preserving line breaks.
 *
 * Order matters: report-specific symbols are mapped first, then the shared
 * sanitiser handles the WinAnsi test, the shared technical-symbol table
 * (Ω → Ohm, ≤ → <=, ∆ → delta, → → ->) and the NFKD transliteration, falling
 * back to a visible `?`. A `?` is honest; a silent `©` is not.
 */
export function toWinAnsiSafe(text: string): string {
  let mapped = ''
  for (const ch of text) mapped += REPORT_REPLACEMENTS[ch] ?? ch
  return winAnsiSafe(mapped, { collapseWhitespace: false })
}

/**
 * Nullish-preserving wrapper.
 *
 * The document distinguishes "no value" (rendered as a muted em dash) from an
 * empty string, so a sanitiser that folded `null` into `''` would quietly
 * restyle rows. Returns exactly what it was given when there is nothing to
 * sanitise.
 */
export function toWinAnsiSafeOptional(
  text: string | null | undefined,
): string | null | undefined {
  return text == null ? text : toWinAnsiSafe(text)
}
