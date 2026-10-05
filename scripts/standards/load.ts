/**
 * Load extracted SANS tables into the reference model, and stamp every legacy
 * table with the audit's verdict. DRY RUN BY DEFAULT: prints the plan.
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/standards/load.ts \
 *     --dataset ~/standards-dataset.json [--audit ~/sans-audit.json] [--apply]
 *
 * One SQL transaction through the Management API (same credential path as
 * scripts/verify-migration-applied.ts): either every table, row and verdict
 * lands, or nothing does. Loaded tables are 'extracted' — the database itself
 * refuses any row without a citation (migration 00225) — and are visible only
 * to the WM org (owner decision D2) unless --visibility-org says otherwise.
 * Re-running replaces the loaded tables' rows; legacy rows are never touched,
 * only their table's `verification`.
 */
import { readFileSync } from 'node:fs'
import { columnCoverage, crosscheck, LEGACY_CROSSCHECKS, type ColumnCoverage } from '../../packages/shared/src/standards/crosscheck.ts'
import { tableCode, type Dataset, type DatasetTable } from '../../packages/shared/src/standards/dataset.ts'
import { readLegacyTables, readOnlyQuery } from './live-tables.ts'

const WM_ORG = 'dddddddd-0000-0000-0000-000000000001'
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const CATEGORY: Record<string, string> = {
  'Table 6.10': 'DERATING_TEMPERATURE',
  'Table 6.11': 'DERATING_TEMPERATURE',
  'Table 6.12': 'DERATING_THERMAL_RESISTIVITY',
  'Table 6.13': 'DERATING_SPACING',
  'Table 6.16': 'DERATING_DEPTH',
}

/** Not checkable against the library, and why. */
const NOT_CHECKABLE: Record<string, string> = {
  MV: 'MV paper/XLPE data (SANS 97 / SANS 1339 constructions) — neither standard nor the Aberdare booklet is in the WM library.',
  XLPE: 'XLPE ratings are manufacturer data: SANS 10142-1 publishes no XLPE ampacity tables, and SANS 1507-4 is not in the library.',
  AL: 'Aluminium PVC ratings: SANS 10142-1 Tables 6.4(a)/6.8 tabulate copper only; SANS 1507-3 is not in the library.',
  SINGLE: 'Single-core ratings use Aberdare installation conditions with no cell-for-cell SANS 10142-1 counterpart.',
  K: 'Short-circuit k-factors come from IEC 60364-4-43, which is not in the library.',
  INTERDAC: 'Aberdare INTERDAC 3 product data — no standard counterpart.',
  AIRGROUP: 'SANS 10142-1 Table 6.14 tabulates air grouping on a different installation basis; not comparable cell for cell — needs an engineer\'s review.',
}
const NOT_CHECKABLE_BY_CODE: Record<string, string> = {
  TABLE_4_2: 'MV', TABLE_4_3_1: 'MV', TABLE_4_3_2: 'MV', TABLE_4_3_3: 'MV', TABLE_4_3_4: 'MV', TABLE_4_3_5: 'MV', TABLE_4_3_6: 'MV',
  TABLE_5_2: 'MV', TABLE_5_2_1: 'MV', TABLE_5_2_2: 'MV', TABLE_5_2_3: 'MV', TABLE_5_2_4: 'MV', TABLE_5_2_5: 'MV', TABLE_5_2_6: 'MV', TABLE_5_3: 'MV',
  TABLE_6_3: 'AL', TABLE_6_4: 'XLPE', TABLE_6_5: 'XLPE', TABLE_6_6: 'SINGLE', TABLE_6_7: 'SINGLE',
  TABLE_6_9: 'K', TABLE_9_1: 'INTERDAC', TABLE_6_3_6: 'AIRGROUP',
}

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
const j = (v: unknown): string => {
  const body = JSON.stringify(v)
  if (body.includes('$j$')) throw new Error('unexpected $j$ in payload')
  return `$j$${body}$j$::jsonb`
}

function tableSql(t: DatasetTable, visibilityOrg: string, source: { file: string; sha256: string }): string {
  // Legacy tables are TABLE_*; an extracted code must never collide with one.
  if (/^TABLE_/i.test(t.code)) throw new Error(`refusing to load ${t.code}: that is a legacy table code`)
  const columns = [t.keyColumn, ...t.valueColumns].map((c) => ({
    key: c.key, label: c.label, unit: c.unit, type: c.type === 'text' || (c === t.keyColumn && (t.keyColumn.kind === 'band' || t.keyColumn.kind === 'text' || t.keyColumn.header === 0)) ? 'string' : 'number',
    ...(c.group ? { group: c.group } : {}),
  }))
  const standardLabel = `${t.document.code}:${t.document.year}`
  const sourceRef = `${standardLabel} Ed ${t.document.edition}, ${t.clause} — extracted by scripts/standards/extract.ts from ${source.file} (sha256 ${source.sha256.slice(0, 12)})`
  const std = `(SELECT id FROM cable_schedule.ref_standards WHERE code = ${q(t.document.code)} AND edition = ${q(t.document.edition)})`
  const rows = t.rows.map((r) => `(${r.sort_key}, ${j(r.row_data)}, ${j(r.citation)})`).join(',\n    ')
  return `
-- ${t.code}
INSERT INTO cable_schedule.sans_tables
  (code, title, standard, section_number, columns, notes, source_ref, category, standard_id, clause, provenance, visibility_org_id, topic, conditions)
VALUES (${q(t.code)}, ${q(t.title)}, ${q(standardLabel)}, ${q(t.clause.replace(/^Table /, ''))}, ${j(columns)},
        ${t.remark ? q(t.remark) : 'NULL'}, ${q(sourceRef)}, ${CATEGORY[t.clause] ? q(CATEGORY[t.clause]) : 'NULL'},
        ${std}, ${q(t.clause)}, 'extracted', ${q(visibilityOrg)}, ${q(t.topic)}, ${j(t.conditions)})
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title, standard = EXCLUDED.standard, section_number = EXCLUDED.section_number,
  columns = EXCLUDED.columns, notes = EXCLUDED.notes, source_ref = EXCLUDED.source_ref,
  category = EXCLUDED.category, standard_id = EXCLUDED.standard_id, clause = EXCLUDED.clause,
  visibility_org_id = EXCLUDED.visibility_org_id, topic = EXCLUDED.topic, conditions = EXCLUDED.conditions
  WHERE cable_schedule.sans_tables.provenance = 'extracted';
DELETE FROM cable_schedule.sans_rows
 WHERE table_id = (SELECT id FROM cable_schedule.sans_tables WHERE code = ${q(t.code)} AND provenance = 'extracted');
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data, citation)
SELECT (SELECT id FROM cable_schedule.sans_tables WHERE code = ${q(t.code)} AND provenance = 'extracted'), v.sort_key, v.row_data, v.citation
  FROM (VALUES
    ${rows}
  ) AS v(sort_key, row_data, citation);`
}

async function main(): Promise<void> {
  const ds: Dataset = JSON.parse(readFileSync(arg('dataset')!, 'utf8'))
  const audit = arg('audit') ? JSON.parse(readFileSync(arg('audit')!, 'utf8')) : null
  const visibilityOrg = arg('visibility-org') ?? WM_ORG
  const apply = process.argv.includes('--apply')
  const today = new Date().toISOString().slice(0, 10)

  const toLoad = ds.tables
  const statements: string[] = []
  for (const t of toLoad) {
    const doc = ds.documents.find((d) => d.code === t.document.code && d.year === t.document.year)!
    statements.push(tableSql(t, visibilityOrg, doc))
    console.log(`load   ${t.code.padEnd(26)} ${String(t.rows.length).padStart(3)} rows, every row cited (${t.clause}, printed p.${t.rows[0].citation.page_printed})`)
  }

  // Legacy verdicts, recomputed from live data (never copied from a report).
  const live = await readLegacyTables()
  const verdicts = new Map<string, Record<string, unknown>>()
  for (const lt of live) {
    const totalCells = lt.rows.reduce((n, r) => n + Object.keys(r.row).length, 0)
    const mappings = LEGACY_CROSSCHECKS.filter((m) => m.legacyCode === lt.code)
    if (mappings.length > 0) {
      let equal = 0; let differ = 0; let none = 0
      const against: Array<Record<string, unknown>> = []
      const coverage: Record<string, ColumnCoverage> = {}
      for (const m of mappings) {
        const st = ds.tables.find((t) => t.code === tableCode('SANS 10142-1', 2021, m.sansClause))!
        const r = crosscheck(m, lt.rows.map((x) => x.row), st.rows.map((x) => x.row_data))
        // A mapping that compared nothing proves nothing — a wrong key scale or
        // column name would otherwise read as "verified".
        if (r.matched + r.mismatched === 0) throw new Error(`${lt.code} vs Table ${m.sansClause}: no cell was compared — check the mapping`)
        equal += r.matched; differ += r.mismatched; none += r.noCounterpart
        for (const [col, cov] of Object.entries(columnCoverage(r, lt.rows.map((x) => Number(x.row[m.legacyKey]))))) {
          coverage[col] = { ...cov, against_index: against.length }
        }
        against.push({ table_code: st.code, standard: `${st.document.code}:${st.document.year}`, edition: st.document.edition,
          clause: st.clause, page_printed: st.rows[0].citation.page_printed, page_pdf: st.rows[0].citation.page_pdf })
      }
      const keyCells = lt.rows.length // key column cells are the comparison's join, not values
      const status = differ > 0 ? 'mismatch' : equal + keyCells >= totalCells ? 'verified' : 'partially_verified'
      verdicts.set(lt.code, { status, checked_on: today, against, coverage, cells_total: totalCells, cells_equal: equal, cells_differ: differ,
        cells_without_sans_counterpart: none,
        note: status === 'partially_verified' ? 'Every compared cell equals SANS; the remaining cells have no SANS counterpart (see cells_without_sans_counterpart) or are not tabulated by SANS (dimensions, volt drop, impedance).' : null })
    } else if (lt.code === 'TABLE_6_3_7') {
      // Checked by audit.ts's band reader. Without that file, leave the stored
      // verdict alone rather than downgrade it.
      if (!audit?.solar) continue
      const s = audit.solar as { matched: number; mismatched: number; cite: string }
      verdicts.set(lt.code, { status: s.mismatched > 0 ? 'mismatch' : 'verified', checked_on: today, cells_equal: s.matched, cells_differ: s.mismatched,
        against: [{ citation: s.cite }], note: null })
    } else {
      const reason = NOT_CHECKABLE_BY_CODE[lt.code]
      verdicts.set(lt.code, { status: 'not_checkable', checked_on: today, note: reason ? NOT_CHECKABLE[reason] : 'No counterpart in the WM standards library.' })
    }
  }
  for (const [code, v] of verdicts) {
    statements.push(`UPDATE cable_schedule.sans_tables SET verification = ${j(v)} WHERE code = ${q(code)} AND provenance = 'transcribed';`)
    console.log(`verdict ${code.padEnd(13)} ${String(v.status).padEnd(18)} ${v.cells_equal != null ? `${v.cells_equal} equal / ${v.cells_differ} differ` : ''}`)
  }

  if (!apply) { console.log(`\nDRY RUN — ${toLoad.length} tables, ${verdicts.size} verdicts. Re-run with --apply.`); return }

  const sql = `BEGIN;\n${statements.join('\n')}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;`
  const { execFileSync } = await import('node:child_process')
  const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? (raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice(18), 'base64').toString('utf8').trim() : raw)
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok || !Array.isArray(JSON.parse(text))) throw new Error(`load failed: ${text.slice(0, 400)}`)

  // Read back: every loaded row cited, counts as planned.
  const back = await readOnlyQuery<{ code: string; n: number; cited: number }>(`
    SELECT t.code, count(r.*)::int AS n, count(r.citation)::int AS cited
      FROM cable_schedule.sans_tables t LEFT JOIN cable_schedule.sans_rows r ON r.table_id = t.id
     WHERE t.provenance = 'extracted' AND t.code IN (${toLoad.map((t) => q(t.code)).join(', ')})
     GROUP BY t.code ORDER BY t.code`)
  for (const b of back) console.log(`read back ${b.code}: ${b.n} rows, ${b.cited} cited`)
  const bad = back.filter((b) => b.n !== b.cited || b.n !== toLoad.find((t) => t.code === b.code)?.rows.length)
  if (back.length !== toLoad.length) bad.push(...toLoad.filter((t) => !back.some((b) => b.code === t.code)).map((t) => ({ code: t.code, n: 0, cited: 0 })))
  if (bad.length) throw new Error(`read-back mismatch: ${bad.map((b) => b.code).join(', ')}`)
  console.log('applied and read back.')
}

main().catch((e) => { console.error(e); process.exit(1) })
