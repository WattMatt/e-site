/**
 * The extracted-dataset contract shared by the extractor, the audit and the
 * loader. A dataset is produced from the licensed PDFs on a staff machine and
 * written OUTSIDE the repository (the repo is public): it carries values.
 */
import type { ExtractedRow, TableSpec } from './extract-table'

export interface DatasetDocument {
  file: string
  sha256: string
  /** As printed on the document, e.g. "SANS 10142-1". */
  code: string
  /** As printed on the document, e.g. "3.1". */
  edition: string
  year: number
}

export interface DatasetTable {
  /** Stable code, e.g. SANS_10142_1_2021_T6_13. */
  code: string
  document: { code: string; edition: string; year: number }
  clause: string
  title: string
  keyColumn: TableSpec['keyColumn']
  valueColumns: TableSpec['valueColumns']
  remark: string | null
  rows: ExtractedRow[]
}

export interface Dataset {
  generated_at: string
  documents: DatasetDocument[]
  tables: DatasetTable[]
}

/** SANS_10142_1_2021_T6_13 / …_T6_4A — derived, never typed. */
export function tableCode(docCode: string, year: number, clause: string): string {
  const doc = docCode.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '').toUpperCase()
  const cl = clause.replace(/\(([a-z])\)/g, (_, l: string) => l.toUpperCase()).replace(/[^A-Za-z0-9]+/g, '_')
  return `${doc}_${year}_T${cl}`
}

/**
 * Code, edition and year as printed on the document itself ("SANS
 * 10142-1:2021" + "Edition 3.1"), taken as the most frequent occurrence in
 * the running headers. Throws when either cannot be read.
 */
export function readDocumentIdentity(text: string, expectedCode: string): { edition: string; year: number } {
  const esc = expectedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const years = new Map<number, number>()
  for (const m of text.matchAll(new RegExp(`${esc}:(\\d{4})`, 'g'))) {
    const y = Number(m[1]); years.set(y, (years.get(y) ?? 0) + 1)
  }
  const editions = new Map<string, number>()
  for (const m of text.matchAll(/Edition\s+(\d+(?:\.\d+)?)/g)) {
    editions.set(m[1], (editions.get(m[1]) ?? 0) + 1)
  }
  const top = <K>(m: Map<K, number>): K | undefined => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const year = top(years)
  const edition = top(editions)
  if (year === undefined || edition === undefined) {
    throw new Error(`cannot read ${expectedCode}'s year and edition from the document`)
  }
  return { edition, year }
}
