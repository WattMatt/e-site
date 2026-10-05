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
import { extractTable, type TableSpec } from '../../packages/shared/src/standards/extract-table.ts'
import { splitPdfText } from '../../packages/shared/src/standards/pdf-text.ts'
import { SANS_10142_1_SPECS, SANS_10142_1_2017_SPECS, SANS_10400_XA_SPECS } from '../../packages/shared/src/standards/specs.ts'
import {
  readDocumentIdentity, tableCode, type Dataset, type DatasetDocument, type DatasetTable,
} from '../../packages/shared/src/standards/dataset.ts'


/** Library files and the document code each must declare on its pages. */
const SOURCES: Array<{ file: string; code: string; specs: Record<string, TableSpec> }> = [
  { file: '07 - SANS Electrical Standards/SANS-10142-1-2021-(Ed.-3.01).pdf', code: 'SANS 10142-1', specs: SANS_10142_1_SPECS },
  // The superseded edition: the tables loaded since 2026-10-05 (derating), kept queryable.
  { file: '07 - SANS Electrical Standards/SANS10142-1_2017_Ed2-1 (3).pdf', code: 'SANS 10142-1', specs: SANS_10142_1_2017_SPECS },
  { file: '08 - SANS 10400 Building Regulations/sans-10400-xa-the-application-of-the-national-building-regulations-environmental-sustainability-energy-usage-in-buildings-2021.pdf', code: 'SANS 10400-XA', specs: SANS_10400_XA_SPECS },
]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const flagOn = (n: string): boolean => process.argv.includes(`--${n}`)

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
  const docFilter = arg('doc')
  for (const src of SOURCES) {
    if (docFilter && !src.file.includes(docFilter)) continue
    const path = join(library, src.file)
    if (statSync(path).size === 0) {
      throw new Error(`${src.file} is 0 bytes — a Dropbox online-only placeholder; open it once to download it`)
    }
    const bytes = readFileSync(path)
    const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const { edition, year } = readDocumentIdentity(text, src.code)
    documents.push({ file: src.file, sha256: createHash('sha256').update(bytes).digest('hex'), code: src.code, edition, year })
    const pages = splitPdfText(text)
    const only = arg('only')?.split(',').map((x) => x.trim())
    for (const spec of Object.values(src.specs)) {
      if (only && !only.includes(spec.clause + (spec.codeSuffix ? `/${spec.codeSuffix}` : '')) && !only.includes(spec.clause)) continue
      const { rows, conditions } = extractTable(pages, spec)
      tables.push({
        code: tableCode(src.code, year, spec.clause, spec.codeSuffix),
        document: { code: src.code, edition, year },
        clause: `Table ${spec.clause}`,
        title: spec.title,
        topic: spec.topic,
        conditions,
        keyColumn: spec.keyColumn,
        valueColumns: spec.subColumns ? [...spec.valueColumns.filter((c) => !spec.subColumns!.columns.some((s) => s.key === c.key)), ...spec.subColumns.columns] : spec.valueColumns,
        remark: spec.remark ?? null,
        rows,
      })
      const cond = conditions.map((c) => `${c.label} ${c.value}${c.unit ? ' ' + c.unit : ''}`).join('; ')
      if (flagOn('print')) {
        console.log(`--- ${spec.clause}${spec.codeSuffix ? ' ' + spec.codeSuffix : ''}: ${rows.length} rows`)
        for (const r of rows) console.log('   ', JSON.stringify(r.citation.printed), 'p.' + r.citation.page_printed)
      }
      console.log(`${src.code}:${year} Ed ${edition}  Table ${(spec.clause + (spec.codeSuffix ? ' ' + spec.codeSuffix : '')).padEnd(10)} ${String(rows.length).padStart(3)} rows  printed p.${rows[0].citation.page_printed} (PDF p.${rows[0].citation.page_pdf})${cond ? '  [' + cond + ']' : ''}`)
    }
  }
  const dataset: Dataset = { generated_at: new Date().toISOString(), documents, tables }
  writeFileSync(outPath, JSON.stringify(dataset, null, 2))
  console.log(`wrote ${tables.length} tables → ${outPath}`)
}

main()
