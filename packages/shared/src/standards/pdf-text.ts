/**
 * Page-level helpers for `pdftotext -layout` output of SABS standards.
 *
 * The extractor never stores or ships the text itself — only numbers read
 * out of tables, each with the page it came from. These helpers turn the raw
 * dump into pages, drop the per-page licence watermark, and work out the
 * PRINTED page number (the one an engineer finds in the paper copy), which
 * differs from the PDF page index by the front-matter offset.
 */

export interface PdfPage {
  /** 1-based page index in the PDF file. */
  pdfPage: number
  /** Number printed on the page, when it can be read from the page itself. */
  printedOnPage: number | null
  lines: string[]
}

const WATERMARK = /Licensed exclusively|paper copy|Copying and network storage/i

/** Split a `pdftotext -layout` dump (pages separated by form feeds) into pages. */
export function splitPdfText(text: string): PdfPage[] {
  const raw = text.split('\f')
  // pdftotext ends the last page with a form feed, which leaves an empty tail.
  if (raw.length > 1 && raw[raw.length - 1].trim() === '') raw.pop()
  return raw.map((pageText, i) => {
    const lines = pageText.split('\n').filter((l) => !WATERMARK.test(l))
    return { pdfPage: i + 1, printedOnPage: readPrintedPage(lines), lines }
  })
}

/**
 * The printed page number, read from the "© SABS" footer ("118  © SABS" on a
 * left page, "© SABS  119" on a right page). Landscape pages carry the number
 * on a line of its own or at the start of a line, so those are tried next.
 */
export function readPrintedPage(lines: string[]): number | null {
  // The footer line holds only the number and "© SABS". A data row can share a
  // line with "© SABS" ("120 … © SABS …"), so anything else on the line rules it out.
  for (const l of lines) {
    const m = l.match(/^\s*(\d{1,3})\s+©\s*SABS\s*$|^\s*©\s*SABS\s+(\d{1,3})\s*$/)
    if (m) return Number(m[1] ?? m[2])
  }
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  // Bottom first: a landscape page prints its number at the foot, and its header
  // can hold a lone digit (the "2" of a superscript mm²).
  const edges = [...nonEmpty.slice(-6).reverse(), ...nonEmpty.slice(0, 6)]
  for (const l of edges) {
    const alone = l.match(/^\s*(\d{1,3})\s*$/)
    if (alone) return Number(alone[1])
  }
  for (const l of edges) {
    // "119      …      Edition 2" — words after the number, so a column-number
    // row ("1   2   3") is never read as a page number.
    const lead = l.match(/^\s*(\d{1,3})\s{5,}.*[A-Za-z]/)
    if (lead) return Number(lead[1])
  }
  return null
}

/**
 * The document's front-matter offset (pdfPage − printed page), taken as the
 * most common difference over the pages whose number could be read. Throws
 * when fewer than half of the readable pages agree — then page citations
 * cannot be trusted and nothing should be extracted.
 */
export function pageOffset(pages: PdfPage[]): number {
  const counts = new Map<number, number>()
  let readable = 0
  for (const p of pages) {
    if (p.printedOnPage == null) continue
    readable++
    const d = p.pdfPage - p.printedOnPage
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  let best: number | null = null
  let bestN = 0
  for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n }
  if (best == null || bestN * 2 < readable) {
    throw new Error(`page numbering is inconsistent (${bestN} of ${readable} readable pages agree)`)
  }
  return best
}

/**
 * The printed page for a PDF page: the document offset applied, cross-checked
 * against the number read off the page itself when there is one.
 */
export function printedPage(page: PdfPage, offset: number): number {
  const derived = page.pdfPage - offset
  if (page.printedOnPage != null && page.printedOnPage !== derived) {
    throw new Error(
      `PDF page ${page.pdfPage}: printed number ${page.printedOnPage} disagrees with the document offset (${derived})`,
    )
  }
  return derived
}

/**
 * A table cell as printed in a SABS standard: decimal comma ("1,22") and an
 * en dash for "not applicable". Returns the number, `null` for a dash, or `undefined` when the
 * token is not a cell value at all.
 */
export function parseCell(token: string): number | null | undefined {
  const t = token.trim()
  if (t === '\u2013' || t === '-' || t === '\u2014') return null
  // A thousands group printed with one space ("1 138") reaches here merged by lineTokens.
  if (/^\d{1,3}(?: \d{3})+$/.test(t)) return Number(t.replace(/ /g, ''))
  if (!/^\d+(?:[,.]\d+)?$/.test(t)) return undefined
  return Number(t.replace(',', '.'))
}
