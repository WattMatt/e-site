/**
 * Extract cited tables from the SANS PDFs in the WM standards library.
 * Run by WM staff on a machine that holds the library (licensed documents).
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/standards/extract.ts \
 *     --library "<…>/004. SANS REFERENCE BOOKS" --out ~/standards-dataset.json
 *
 * Writes a dataset of VALUES with a citation on every row. The repository is
 * public, so --out must resolve outside it: the script refuses otherwise.
 * Needs poppler's pdftotext on PATH (brew install poppler). Dropbox
 * "online-only" files read as 0 bytes — open them once so Dropbox downloads them.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { outsideRepo } from './outside-repo.ts'
import { extractTable } from '../../packages/shared/src/standards/extract-table.ts'
import { splitPdfText } from '../../packages/shared/src/standards/pdf-text.ts'
import { SANS_10142_1_SPECS } from '../../packages/shared/src/standards/specs.ts'
import {
  readDocumentIdentity, tableCode, type Dataset, type DatasetDocument, type DatasetTable,
} from '../../packages/shared/src/standards/dataset.ts'


/** Library files and the document code each must declare on its pages. */
const SOURCES = [
  { file: '07 - SANS Electrical Standards/SANS-10142-1-2021-(Ed.-3.01).pdf', code: 'SANS 10142-1' },
  { file: '07 - SANS Electrical Standards/SANS10142-1_2017_Ed2-1 (3).pdf', code: 'SANS 10142-1' },
]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function main(): void {
  const library = arg('library') ?? process.env.SANS_LIBRARY_DIR
  const out = arg('out')
  if (!library || !out) {
    console.error('usage: extract.ts --library <standards library dir> --out <dataset.json outside the repo>')
    process.exit(2)
  }
  let outPath: string
  try { outPath = outsideRepo(out) } catch (e) { console.error((e as Error).message); process.exit(2) }

  const documents: DatasetDocument[] = []
  const tables: DatasetTable[] = []
  for (const src of SOURCES) {
    const path = join(library, src.file)
    if (statSync(path).size === 0) {
      throw new Error(`${src.file} is 0 bytes — a Dropbox online-only placeholder; open it once to download it`)
    }
    const bytes = readFileSync(path)
    const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const { edition, year } = readDocumentIdentity(text, src.code)
    documents.push({ file: src.file, sha256: createHash('sha256').update(bytes).digest('hex'), code: src.code, edition, year })
    const pages = splitPdfText(text)
    for (const spec of Object.values(SANS_10142_1_SPECS)) {
      const rows = extractTable(pages, spec)
      tables.push({
        code: tableCode(src.code, year, spec.clause),
        document: { code: src.code, edition, year },
        clause: `Table ${spec.clause}`,
        title: spec.title,
        keyColumn: spec.keyColumn,
        valueColumns: spec.valueColumns,
        remark: spec.remark ?? null,
        rows,
      })
      console.log(`${src.code}:${year} Ed ${edition}  Table ${spec.clause.padEnd(7)} ${String(rows.length).padStart(3)} rows  printed p.${rows[0].citation.page_printed} (PDF p.${rows[0].citation.page_pdf})`)
    }
  }
  const dataset: Dataset = { generated_at: new Date().toISOString(), documents, tables }
  writeFileSync(outPath, JSON.stringify(dataset, null, 2))
  console.log(`wrote ${tables.length} tables → ${outPath}`)
}

main()
