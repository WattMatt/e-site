/**
 * Audit the legacy SANS reference tables against the standards library.
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/standards/audit.ts \
 *     --dataset ~/standards-dataset.json --out ~/sans-audit.md [--json ~/audit.json]
 *
 * For every live legacy table: where it comes from, and a verdict. Cells are
 * compared with the SANS 10142-1 table each is claimed to equal (mappings in
 * packages/shared/src/standards/crosscheck.ts); the solar-radiation table is
 * read by its size bands. The report carries values and page citations, so
 * like the dataset it must be written OUTSIDE the public repository.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { outsideRepo } from './outside-repo.ts'
import { crosscheck, LEGACY_CROSSCHECKS, type CrosscheckResult } from '../../packages/shared/src/standards/crosscheck.ts'
import { pageOffset, parseCell, printedPage, splitPdfText } from '../../packages/shared/src/standards/pdf-text.ts'
import { findTablePage } from '../../packages/shared/src/standards/extract-table.ts'
import { tableCode, type Dataset, type DatasetTable } from '../../packages/shared/src/standards/dataset.ts'
import { readLegacyTables, type LiveTable } from './live-tables.ts'

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const outside = outsideRepo

/** Solar radiation (Table 6.19) is keyed by size bands ("1,5 – 10"), read here. */
function solarBands(library: string, file: string): { rows: Array<{ band: string; coastal: number; highveld: number }>; pdf: number; printed: number } {
  const text = execFileSync('pdftotext', ['-layout', join(library, file), '-'], { encoding: 'utf8', maxBuffer: 64 << 20 })
  const pages = splitPdfText(text)
  const { pageIdx, lineIdx } = findTablePage(pages, '6.19')
  const page = pages[pageIdx]
  const rows: Array<{ band: string; coastal: number; highveld: number }> = []
  for (const l of page.lines.slice(lineIdx + 1)) {
    if (/^\s*(NOTE|Table)\b/.test(l)) break
    const m = l.match(/^\s*([\d,]+)\s*[–-]\s*(\d+)\s+(\S+)\s+(\S+)\s*$/)
    if (!m) continue
    const c = parseCell(m[3]); const h = parseCell(m[4])
    if (typeof c !== 'number' || typeof h !== 'number') continue
    rows.push({ band: `${m[1].replace(',', '.')} - ${m[2]}`, coastal: c, highveld: h })
  }
  return { rows, pdf: page.pdfPage, printed: printedPage(page, pageOffset(pages)) }
}

const fmt = (v: unknown): string => (v === null || v === undefined ? '—' : String(v))

async function main(): Promise<void> {
  const ds: Dataset = JSON.parse(readFileSync(arg('dataset')!, 'utf8'))
  const out = outside(arg('out')!)
  const jsonOut = arg('json') ? outside(arg('json')!) : null
  const library = arg('library') ?? process.env.SANS_LIBRARY_DIR
  const live = await readLegacyTables()
  const byCode = new Map(live.map((t) => [t.code, t]))
  const sans2021 = (clause: string): DatasetTable | undefined =>
    ds.tables.find((t) => t.code === tableCode('SANS 10142-1', 2021, clause))
  const sans2017 = (clause: string): DatasetTable | undefined =>
    ds.tables.find((t) => t.code === tableCode('SANS 10142-1', 2017, clause))

  const results: Array<CrosscheckResult & { cite: string; editionsAgree: boolean }> = []
  for (const m of LEGACY_CROSSCHECKS) {
    const lt = byCode.get(m.legacyCode)
    const st = sans2021(m.sansClause)
    const old = sans2017(m.sansClause)
    if (!lt || !st) throw new Error(`missing ${m.legacyCode} or 2021 Table ${m.sansClause}`)
    const r = crosscheck(m, lt.rows.map((x) => x.row), st.rows.map((x) => x.row_data))
    if (r.matched + r.mismatched === 0) throw new Error(`${m.legacyCode} vs Table ${m.sansClause}: no cell was compared — check the mapping`)
    const editionsAgree = !!old && JSON.stringify(old.rows.map((x) => x.row_data)) === JSON.stringify(st.rows.map((x) => x.row_data))
    const c = st.rows[0].citation
    results.push({ ...r, cite: `SANS 10142-1:2021 Ed ${st.document.edition}, Table ${m.sansClause}, printed p.${c.page_printed} (PDF p.${c.page_pdf})`, editionsAgree })
  }

  let solar: { matched: number; mismatched: number; cite: string; lines: string[] } | null = null
  if (library) {
    const s = solarBands(library, '07 - SANS Electrical Standards/SANS-10142-1-2021-(Ed.-3.01).pdf')
    const lt = byCode.get('TABLE_6_3_7')!
    let matched = 0; let mismatched = 0; const lines: string[] = []
    for (const r of lt.rows) {
      const band = String(r.row.size_band).replace(/\s+/g, ' ')
      const sr = s.rows.find((x) => x.band === band)
      for (const [col, sv] of [['factor_coastal', sr?.coastal], ['factor_highveld', sr?.highveld]] as const) {
        const ok = sv !== undefined && sv === r.row[col]
        if (ok) matched++; else { mismatched++; lines.push(`| TABLE_6_3_7 | ${band} | ${col} | ${fmt(r.row[col])} | ${fmt(sv)} |`) }
      }
    }
    solar = { matched, mismatched, cite: `SANS 10142-1:2021 Ed 3.1, Table 6.19, printed p.${s.printed} (PDF p.${s.pdf})`, lines }
  }

  const totalCells = live.reduce((n, t) => n + t.rows.reduce((k, r) => k + Object.keys(r.row).length, 0), 0)
  const compared = results.reduce((n, r) => n + r.matched + r.mismatched, 0) + (solar ? solar.matched + solar.mismatched : 0)
  const md: string[] = []
  md.push(`# SANS reference audit — ${new Date().toISOString().slice(0, 10)}`, '')
  md.push(`Live legacy tables: ${live.length}; cells: ${totalCells}. Cells compared with a cited SANS value: ${compared} (${((100 * compared) / totalCells).toFixed(1)} %).`, '')
  md.push('## Cross-checks', '', '| Legacy table | SANS source | Equal | Differ | No SANS counterpart | 2017 = 2021 |', '|---|---|---|---|---|---|')
  for (const r of results) md.push(`| ${r.legacyCode} | ${r.cite} | ${r.matched} | ${r.mismatched} | ${r.noCounterpart} | ${r.editionsAgree ? 'yes' : 'NO'} |`)
  if (solar) md.push(`| TABLE_6_3_7 | ${solar.cite} | ${solar.matched} | ${solar.mismatched} | 0 | n/a |`)
  md.push('', '## Cells that differ', '', '| Table | Key | Column | Legacy | SANS |', '|---|---|---|---|---|')
  for (const r of results) for (const c of r.cells.filter((x) => x.outcome === 'mismatch')) md.push(`| ${r.legacyCode} | ${c.key} | ${c.column} | ${fmt(c.legacy)} | ${fmt(c.sans)} |`)
  if (solar) md.push(...solar.lines)
  md.push('', '## Cells with no SANS counterpart', '', '| Table | Key | Column | Legacy |', '|---|---|---|---|')
  for (const r of results) for (const c of r.cells.filter((x) => x.outcome === 'no_counterpart')) md.push(`| ${r.legacyCode} | ${c.key} | ${c.column} | ${fmt(c.legacy)} |`)
  writeFileSync(out, md.join('\n') + '\n')
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ results, solar, totalCells, compared, tables: live.map((t: LiveTable) => ({ code: t.code, title: t.title, standard: t.standard, section: t.section_number, source_ref: t.source_ref, rows: t.rows.length, cells: t.rows.reduce((k, r) => k + Object.keys(r.row).length, 0) })) }, null, 2))
  console.log(md.slice(0, 16).join('\n'))
}

main().catch((e) => { console.error(e); process.exit(1) })
