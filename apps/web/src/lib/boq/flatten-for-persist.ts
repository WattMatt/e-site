import type { ParsedBoq, ParsedSection, ParsedItem } from './types'

/**
 * Flatten a `ParsedBoq` (a list of bills, each with its own temp-id'd section
 * tree + items) into the flat `{ totals, sections, items }` shape that
 * `boqService.persistImport` consumes.
 *
 * The parser guarantees EVERY bill's `sections[]` includes its own
 * `kind:'bill'` root (with `parentTempId === ''`), so flattening is a simple
 * concat of all `bills[].sections` and all `bills[].items`. Totals come from the
 * workbook's expected ex-VAT / VAT / incl-VAT figures (the Main Summary).
 *
 * Defensively asserts the result has no dangling references before handing it to
 * persistence:
 *   - every section's `parentTempId` is `''` (a root) or matches some section's
 *     `tempId`
 *   - every item's `sectionTempId` matches some section's `tempId`
 * A dangling ref would silently orphan rows (parent_section_id=null) or drop
 * items, so we throw a clear error instead.
 */
export function flattenForPersist(parsed: ParsedBoq): {
  totals: { exVat: number | null; vat: number | null; inclVat: number | null }
  sections: ParsedSection[]
  items: ParsedItem[]
} {
  const sections: ParsedSection[] = []
  const items: ParsedItem[] = []
  for (const bill of parsed.bills) {
    sections.push(...bill.sections)
    items.push(...bill.items)
  }

  const sectionTempIds = new Set(sections.map((s) => s.tempId))

  for (const s of sections) {
    if (s.parentTempId !== '' && !sectionTempIds.has(s.parentTempId)) {
      throw new Error(
        `Dangling section parent: section "${s.tempId}" references missing parent "${s.parentTempId}"`,
      )
    }
  }
  for (const it of items) {
    if (!sectionTempIds.has(it.sectionTempId)) {
      throw new Error(
        `Dangling item section: item "${it.code ?? it.description}" references missing section "${it.sectionTempId}"`,
      )
    }
  }

  return {
    totals: {
      exVat: parsed.totalExVatExpected,
      vat: parsed.vatExpected,
      inclVat: parsed.totalInclVatExpected,
    },
    sections,
    items,
  }
}
