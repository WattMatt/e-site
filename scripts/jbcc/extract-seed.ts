// scripts/jbcc/extract-seed.ts
// One-off: read SPEC DOCS/JBCC/{xlsx,Letters/*.docx} and emit seed SQL
// into 00099_jbcc_module.sql (appended) and 00100_jbcc_notice_fields_seed.sql.
//
// Run: pnpm tsx scripts/jbcc/extract-seed.ts
// Override the source dir: JBCC_SOURCE_DIR=/path/to/JBCC pnpm tsx scripts/jbcc/extract-seed.ts

import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve, dirname } from 'node:path'
import ExcelJS from 'exceljs'

// --- paths -----------------------------------------------------------------

const __dirname  = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT   = resolve(__dirname, '..', '..')
const JBCC_DIR    = process.env.JBCC_SOURCE_DIR
  ?? '/Users/spud/Documents/DEVELOPER/ESITE.V1/SPEC DOCS/JBCC'
const XLSX_PATH   = join(JBCC_DIR, 'JBCC - Clause & Notice Reference.xlsx')
const LETTERS_DIR = join(JBCC_DIR, 'Letters')
const MIGRATION   = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations/00099_jbcc_module.sql')
const FIELDS_SEED = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations/00100_jbcc_notice_fields_seed.sql')

// --- helpers ---------------------------------------------------------------

const sqlStr = (v: unknown): string =>
  v === null || v === undefined || v === '' ? 'NULL'
  : `'${String(v).replace(/'/g, "''")}'`

const sqlInt = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? String(n) : 'NULL'
}

const cellText = (cell: ExcelJS.Cell): string => {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'richText' in (v as object)) {
    return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('')
  }
  return String(v).trim()
}

// --- 1. parse the xlsx -----------------------------------------------------

interface Notice {
  code: string; title: string; category: string; triggering_clause: string
  contract: string; edition: string; time_bar_text: string
  time_bar_days: number | null; time_bar_unit: 'WD' | 'CD' | null
  time_bar_basis: string | null; from_party: string; to_party: string
  purpose: string; consequence_of_failure: string; template_file: string
  sort_order: number
}
interface Clause {
  clause_ref: string; contract: string; edition: string; topic: string
  description: string; practical_use: string; time_bar: string
  triggering_event: string; linked_notice: string
  consequence_of_failure: string; sort_order: number
}
interface TimeBar {
  clause: string; time_period: string; parties: string; action: string
  sort_order: number
}

// Parse "20 WD" / "14 CD" / "Promptly..." into (days, unit) or (null, null).
function parseTimeBar(text: string): { days: number | null; unit: 'WD' | 'CD' | null } {
  const m = text.match(/(\d+)\s*(WD|CD)/i)
  return m ? { days: Number(m[1]), unit: m[2].toUpperCase() as 'WD' | 'CD' } : { days: null, unit: null }
}

const CATEGORY_BY_CODE: Record<string, string> = {
  'N-01': 'Changes, Delays & Site Conditions', 'N-02': 'Changes, Delays & Site Conditions',
  'N-03': 'Changes, Delays & Site Conditions', 'N-04': 'Changes, Delays & Site Conditions',
  'N-05': 'Changes, Delays & Site Conditions', 'N-06': 'Changes, Delays & Site Conditions',
  'N-07': 'Financial & Security', 'N-08': 'Financial & Security', 'N-09': 'Financial & Security',
  'N-10': 'Financial & Security', 'N-11': 'Financial & Security',
  'N-12': 'Performance & Administrative', 'N-13': 'Performance & Administrative',
  'N-14': 'Performance & Administrative', 'N-15': 'Performance & Administrative',
  'N-16': 'Performance & Administrative', 'N-17': 'Performance & Administrative',
  'N-18': 'Performance & Administrative', 'N-21': 'Performance & Administrative',
  'N-22': 'Performance & Administrative',
  'N-19': 'Subcontract', 'N-20': 'Subcontract',
  'N-23': 'Suspension & Termination', 'N-24': 'Suspension & Termination',
  'N-25': 'Suspension & Termination', 'N-27': 'Suspension & Termination',
  'N-26': 'Dispute Resolution', 'N-28': 'Dispute Resolution',
}

async function readXlsx(): Promise<{ notices: Notice[]; clauses: Clause[]; timebars: TimeBar[] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(XLSX_PATH)

  // Sheet 1: Clause Register — header at row 3, data from row 4.
  const clauses: Clause[] = []
  const s1 = wb.worksheets[0]
  s1.eachRow((row, n) => {
    if (n < 4) return
    const clauseRef = cellText(row.getCell(1))
    if (!clauseRef) return
    if (clauseRef === 'Clause Ref.') return  // header row
    clauses.push({
      clause_ref:             clauseRef,
      contract:               cellText(row.getCell(2)),
      edition:                cellText(row.getCell(3)),
      topic:                  cellText(row.getCell(4)),
      description:            cellText(row.getCell(5)),
      practical_use:          cellText(row.getCell(6)),
      time_bar:               cellText(row.getCell(7)),
      triggering_event:       cellText(row.getCell(8)),
      linked_notice:          cellText(row.getCell(9)),
      consequence_of_failure: cellText(row.getCell(10)),
      sort_order:             clauses.length,
    })
  })

  // Sheet 2: Notice Library — header at row 3, data from row 4.
  const notices: Notice[] = []
  const s2 = wb.worksheets[1]
  const lettersByCode = new Map(
    readdirSync(LETTERS_DIR)
      .filter(f => /^N-\d{2}_.*\.docx$/.test(f))
      .map(f => [f.slice(0, 4), f] as const)
  )
  s2.eachRow((row, n) => {
    if (n < 4) return
    const code = cellText(row.getCell(1))
    if (!/^N-\d{2}$/.test(code)) return
    const tbText = cellText(row.getCell(6))
    const tb = parseTimeBar(tbText)
    const fromTo = cellText(row.getCell(7)) // "Contractor → Principal Agent"
    const [from_party, to_party] = fromTo.split('→').map(s => s.trim())
    notices.push({
      code,
      title:                  cellText(row.getCell(2)),
      category:               CATEGORY_BY_CODE[code] ?? 'Performance & Administrative',
      triggering_clause:      cellText(row.getCell(3)),
      contract:               cellText(row.getCell(4)),
      edition:                cellText(row.getCell(5)),
      time_bar_text:          tbText,
      time_bar_days:          tb.days,
      time_bar_unit:          tb.unit,
      time_bar_basis:         null,
      from_party:             from_party ?? 'Contractor',
      to_party:               to_party ?? 'Principal Agent',
      purpose:                cellText(row.getCell(8)),
      consequence_of_failure: cellText(row.getCell(9)),
      template_file:          lettersByCode.get(code) ?? `${code}.docx`,
      sort_order:             Number(code.slice(2)),
    })
  })

  // Sheet 3: Time-Bar Schedule — header at row 3, data from row 4.
  const timebars: TimeBar[] = []
  const s3 = wb.worksheets[2]
  s3.eachRow((row, n) => {
    if (n < 4) return
    const clause = cellText(row.getCell(1))
    if (!clause) return
    if (clause === 'Clause') return  // header row
    timebars.push({
      clause,
      time_period: cellText(row.getCell(2)),
      parties:     cellText(row.getCell(3)),
      action:      cellText(row.getCell(4)),
      sort_order:  timebars.length,
    })
  })

  return { notices, clauses, timebars }
}

// --- 2. extract placeholders from each .docx -------------------------------

const RECIPIENT_PLACEHOLDERS = new Set([
  'Name of Recipient', 'Principal Agent', 'Company Name',
  'Street Address', 'City, Postal Code',
])
const SENDER_PLACEHOLDERS = new Set([
  'Name of Signatory', 'Project Manager',
])

function classify(p: string): 'recipient' | 'sender' | 'manual' {
  if (RECIPIENT_PLACEHOLDERS.has(p)) return 'recipient'
  if (SENDER_PLACEHOLDERS.has(p)) return 'sender'
  return 'manual'
}

// Field types this script can produce. The DB CHECK allows 'number' too, but
// the heuristics here never classify a placeholder as numeric, so it's left
// out of the union — keeps the return type honest. Future contributors can
// widen this if a numeric placeholder pattern is added.
function fieldType(p: string): 'text' | 'textarea' | 'date' {
  if (/^date$|Insert Date/i.test(p)) return 'date'
  if (/^(describe|specifics|narrative|cause|effect|details?)/i.test(p)) return 'textarea'
  return 'text'
}

function label(p: string): string {
  const trimmed = p.trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function extractPlaceholders(docxPath: string): string[] {
  const xml = execSync(`unzip -p ${JSON.stringify(docxPath)} word/document.xml`, { encoding: 'utf-8' })
  const stripped = xml
    .replace(/<\/w:r>\s*<w:r[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
  const found = new Set<string>()
  const re = /\[([^\]\n]{1,80})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) found.add(m[1].trim())
  return [...found]
}

interface Field {
  code: string; placeholder: string; label: string
  field_type: 'text' | 'textarea' | 'date'
  source: 'recipient' | 'sender' | 'manual'
  required: boolean; sort_order: number
}

function buildFieldRows(): Field[] {
  const fields: Field[] = []
  for (const file of readdirSync(LETTERS_DIR).filter(f => /^N-\d{2}_.*\.docx$/.test(f)).sort()) {
    const code = file.slice(0, 4)
    const placeholders = extractPlaceholders(join(LETTERS_DIR, file))
    placeholders.forEach((p, i) => fields.push({
      code,
      placeholder: `[${p}]`,
      label:       label(p),
      field_type:  fieldType(p),
      source:      classify(p),
      required:    true,
      sort_order:  i,
    }))
  }
  return fields
}

// --- 3. emit SQL ----------------------------------------------------------

function emitReferenceSeed(n: Notice[], c: Clause[], t: TimeBar[]): string {
  const lines: string[] = []
  lines.push('', '-- ============================================================================')
  lines.push('-- Reference seed (extracted from SPEC DOCS/JBCC/...xlsx by scripts/jbcc/extract-seed.ts)')
  lines.push('-- ============================================================================', '')
  lines.push('-- jbcc_notices', ...n.map(r =>
    `INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES (${[
      sqlStr(r.code), sqlStr(r.title), sqlStr(r.category), sqlStr(r.triggering_clause),
      sqlStr(r.contract), sqlStr(r.edition), sqlStr(r.time_bar_text),
      sqlInt(r.time_bar_days), sqlStr(r.time_bar_unit), sqlStr(r.time_bar_basis),
      sqlStr(r.from_party), sqlStr(r.to_party), sqlStr(r.purpose),
      sqlStr(r.consequence_of_failure), sqlStr(r.template_file), sqlInt(r.sort_order),
    ].join(', ')});`
  ))
  lines.push('', '-- jbcc_clauses', ...c.map(r =>
    `INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES (${[
      sqlStr(r.clause_ref), sqlStr(r.contract), sqlStr(r.edition), sqlStr(r.topic),
      sqlStr(r.description), sqlStr(r.practical_use), sqlStr(r.time_bar),
      sqlStr(r.triggering_event), sqlStr(r.linked_notice),
      sqlStr(r.consequence_of_failure), sqlInt(r.sort_order),
    ].join(', ')}) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;`
  ))
  lines.push('', '-- jbcc_time_bar_schedule', ...t.map(r =>
    `INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES (${[
      sqlStr(r.clause), sqlStr(r.time_period), sqlStr(r.parties),
      sqlStr(r.action), sqlInt(r.sort_order),
    ].join(', ')}) ON CONFLICT (clause, sort_order) DO NOTHING;`
  ))
  return lines.join('\n') + '\n'
}

function emitFieldsSeed(fields: Field[]): string {
  const header = [
    '-- 00100_jbcc_notice_fields_seed.sql',
    '-- Placeholder fields per notice, extracted from the 28 .docx templates',
    '-- by scripts/jbcc/extract-seed.ts. Re-run that script after any template',
    '-- change and commit the new seed file.',
    '',
    'BEGIN;',
    '',
  ].join('\n')
  const body = fields.map(f =>
    `INSERT INTO projects.jbcc_notice_fields (notice_id, placeholder, label, field_type, source, required, sort_order) SELECT id, ${sqlStr(f.placeholder)}, ${sqlStr(f.label)}, ${sqlStr(f.field_type)}, ${sqlStr(f.source)}, ${f.required}, ${f.sort_order} FROM projects.jbcc_notices WHERE code = ${sqlStr(f.code)} ON CONFLICT (notice_id, placeholder) DO NOTHING;`
  ).join('\n')
  return header + body + '\n\nCOMMIT;\n'
}

// --- main -----------------------------------------------------------------

async function main() {
  const { notices, clauses, timebars } = await readXlsx()
  const fields = buildFieldRows()

  // Guard against double-append: abort if the seed sentinel is already in
  // MIGRATION. The inner SQL is idempotent (ON CONFLICT DO NOTHING) but the
  // file itself shouldn't grow on every re-run.
  const SENTINEL = '-- Reference seed (extracted from SPEC DOCS/JBCC'
  const existingMigration = readFileSync(MIGRATION, 'utf-8')
  if (existingMigration.includes(SENTINEL)) {
    console.error(`Error: ${MIGRATION} already contains the reference seed block.`)
    console.error('To re-run: git checkout HEAD -- apps/edge-functions/supabase/migrations/00099_jbcc_module.sql && pnpm tsx scripts/jbcc/extract-seed.ts')
    process.exit(1)
  }

  appendFileSync(MIGRATION, emitReferenceSeed(notices, clauses, timebars))
  writeFileSync(FIELDS_SEED, emitFieldsSeed(fields))

  console.log(`  notices:        ${notices.length}  (expected 28)`)
  console.log(`  clauses:        ${clauses.length}  (expected ~38)`)
  console.log(`  time-bars:      ${timebars.length} (expected ~24)`)
  console.log(`  notice-fields:  ${fields.length}`)
  console.log(`\n  appended → ${MIGRATION}`)
  console.log(`  wrote    → ${FIELDS_SEED}`)
}

main().catch(err => { console.error(err); process.exit(1) })
