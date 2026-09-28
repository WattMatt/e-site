/**
 * "View source" (spec §5 charges table, §12 review queue): a stored locator
 * -> what to show. A PDF locator opens its page (rendered in the browser with
 * pdfjs); a workbook locator is shown as a small cell snippet (the workbook
 * is not re-read). findTextBox highlights the cited text on the page.
 */
import type { SourceLocator } from '../../tariffs/types'

export type LocatorView =
  | { kind: 'pdf_page'; page: number; rawText: string | null; label: string | null }
  | { kind: 'cell'; sheet: string | null; cell: string | null; label: string | null; rawText: string | null; rawUnit: string | null }
  | { kind: 'none' }

export function describeLocator(loc: SourceLocator | null | undefined): LocatorView {
  const l = loc ?? {}
  if (typeof l.page === 'number' && l.page > 0) {
    return { kind: 'pdf_page', page: l.page, rawText: l.raw_text ?? null, label: l.label ?? null }
  }
  const cell = l.cell ?? (l.col && typeof l.row === 'number' ? `${l.col}${l.row}` : null)
  if (l.sheet || cell) {
    return { kind: 'cell', sheet: l.sheet ?? null, cell, label: l.label ?? null, rawText: l.raw_text ?? null, rawUnit: l.raw_unit ?? null }
  }
  return { kind: 'none' }
}

export interface PdfTextItem {
  str: string
  /** pdfjs text-item transform: [a, b, c, d, e (x), f (y)]. */
  transform: number[]
  width: number
  height: number
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** The first text item containing the cited text (or the whole of it), in PDF user space. */
export function findTextBox(items: readonly PdfTextItem[], needle: string): { x: number; y: number; width: number; height: number } | null {
  const n = norm(needle)
  if (!n) return null
  const hit = items.find((i) => norm(i.str).includes(n)) ?? items.find((i) => norm(i.str).length >= 4 && n.includes(norm(i.str)))
  if (!hit) return null
  return { x: hit.transform[4], y: hit.transform[5], width: hit.width, height: hit.height || Math.abs(hit.transform[3]) }
}
