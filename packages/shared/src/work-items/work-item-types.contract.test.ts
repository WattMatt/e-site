import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  WORK_ITEM_TYPES, WORK_ITEM_TYPE_KEYS, WORK_ITEM_STATUSES, REF_PREFIXES,
  isWorkItemTypeKey,
} from './types'
import {
  ORG_WRITE_ROLES, MARKUP_WRITE_ROLES, QC_WRITE_ROLES,
  SNAG_FIELD_ROLES, FORMS_FIELD_ROLES,
} from '../types'

/**
 * §12 §(h) test 1. Three sources must agree, in both directions:
 *
 *   Appendix A(b)  <->  the projects.work_item_types seed  <->  WORK_ITEM_TYPES
 *
 * A value that exists in code and not in the appendix, or in the appendix and
 * not in code, fails the build. The appendix and the migration are both PARSED,
 * never restated here — a test that restated them would only ever assert that
 * this file agrees with itself. The shape is the one proven by
 * apps/web/src/lib/snag-photo-type.contract.test.ts.
 *
 * It also holds the ref-prefix lockstep: the CASE in work_items_ensure_ref()
 * and REF_PREFIXES in @esite/shared must agree, because `ref` is immutable and
 * a divergence would ship two different permanent identifiers for the same
 * item.
 *
 * Parsing notes (each one is a real property of the source text, checked):
 *   - The migration is located by CONTENT (the seed statement), not by number,
 *     so a renumber at merge does not break it.
 *   - The seed block is bounded on the statement itself (ON CONFLICT or the
 *     terminating ';', whichever comes first), so the row regex cannot wander
 *     into a later VALUES list (§11's watcher seeding uses one).
 *   - The prefix arms are matched one per line and anchored to the END of the
 *     arm, so `THEN 'QC' || '_DEFECT'` reads as no arm at all rather than as
 *     QC; the comment lines between the last WHEN and the ELSE simply do not
 *     match.
 *   - The status CHECK is read from the `status text` column of
 *     projects.work_items, not from the first `status IN (…)` in the file —
 *     a partial index and a ball-in-court CHECK also carry that phrase.
 *   - The seed is compared AS AMENDED: a later migration may UPDATE a seeded
 *     row in place (00199 sets rfi.gatekeeper_rule = 'creator'), and the
 *     registry production holds is the seed with those UPDATEs applied in
 *     migration order — that, not the raw seed, is what WORK_ITEM_TYPES must
 *     equal. Amendments are parsed with `--` comments blanked (00199's header
 *     carries the rollback statement inside a comment) and only in the
 *     single-column form; any other UPDATE of the registry throws rather than
 *     being skipped.
 */

// packages/shared/src/work-items -> repo root
const ROOT = resolve(__dirname, '../../../..')
const APPENDIX = join(ROOT, 'docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md')
const MIG_DIR = join(ROOT, 'apps/edge-functions/supabase/migrations')

const SEED_NEEDLE = 'INSERT INTO projects.work_item_types'

/** `--` line comments blanked. Used ONLY to locate the migration, so a comment
 *  that merely mentions the seed statement can never be mistaken for it. */
function stripSqlLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/** The one migration that seeds the registry, located by content not by number
 *  (numbers are claimed at merge and this file must survive a renumber). */
function spineMigration(): { path: string; sql: string } {
  for (const name of readdirSync(MIG_DIR).sort()) {
    if (!name.endsWith('.sql')) continue
    const p = join(MIG_DIR, name)
    const sql = readFileSync(p, 'utf8')
    if (stripSqlLineComments(sql).includes(SEED_NEEDLE)) return { path: p, sql }
  }
  throw new Error(`No migration seeds projects.work_item_types (no file in ${MIG_DIR} contains "${SEED_NEEDLE}")`)
}

/** The text between the `### A(b)` and `### A(c)` headings. */
function appendixAb(): string {
  const md = readFileSync(APPENDIX, 'utf8')
  const block = md.split('### A(b)')[1]?.split('### A(c)')[0]
  if (!block) throw new Error(`Could not locate the "### A(b)" … "### A(c)" block in ${APPENDIX}`)
  return block
}

/** A(b)'s table rows: | `key` | Quarter | Source | Default due | Calendar | ... — Q1 only. */
function appendixQ1Keys(): string[] {
  return [...appendixAb().matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*Q1\s*\|/gm)].map((m) => m[1])
}

/** A(b)'s stated column set: `projects.work_item_types (key, label, …, write_roles text[], sort_order, is_active)`. */
function appendixColumns(): string[] {
  const m = appendixAb().match(/`projects\.work_item_types\s*\(([^)]*)\)`/)
  if (!m) throw new Error('A(b) no longer states the projects.work_item_types column set')
  return m[1].split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)
}

interface SeedRow {
  key: string
  days: number
  calendar: string
  gatekeeperRule: string
  roles: string[]
}

/** The seeded VALUES rows: ('rfi', 'RFI', ..., 7, 'office', 'project_pm', ARRAY[...], 1) */
function seededRows(sql: string): SeedRow[] {
  const after = sql.split(SEED_NEEDLE)[1] ?? ''
  const end = after.search(/ON CONFLICT|;/)
  const block = end === -1 ? after : after.slice(0, end)
  return [...block.matchAll(
    /\(\s*'([a-z_]+)'\s*,[^)]*?,\s*(\d+)\s*,\s*'(office|site)'\s*,\s*'([a-z_]+)'\s*,\s*ARRAY\[([^\]]*)\]/g,
  )].map((m) => ({
    key: m[1],
    days: Number(m[2]),
    calendar: m[3],
    gatekeeperRule: m[4],
    roles: [...m[5].matchAll(/'([a-z_]+)'/g)].map((r) => r[1]).sort(),
  }))
}

interface RegistryAmendment {
  file: string
  key: string
  column: 'gatekeeper_rule' | 'calendar' | 'default_days'
  value: string | number
}

const AMENDABLE: readonly RegistryAmendment['column'][] = ['gatekeeper_rule', 'calendar', 'default_days']
/** UPDATE projects.work_item_types SET <col> = '<text>' | <n> WHERE key = '<key>'; */
const AMEND_RE = /UPDATE\s+projects\.work_item_types\s+SET\s+([a-z_]+)\s*=\s*(?:'([a-z_]+)'|(\d+))\s+WHERE\s+key\s*=\s*'([a-z_]+)'\s*;/g

/** Every in-place amendment of a seeded row, from every migration that sorts at
 *  or after the seed's, in file order. Comments are blanked FIRST (the same
 *  rule the locator uses): 00199's header carries the rollback statement — the
 *  same UPDATE with the old value — inside a comment. Every UPDATE of the
 *  registry in CODE must match the single-column, single-key form, or this
 *  throws: an amendment the test cannot model is a reason to extend it, never
 *  to skip it silently. */
function registryAmendments(seedPath: string): RegistryAmendment[] {
  const seedName = seedPath.slice(seedPath.lastIndexOf('/') + 1)
  const out: RegistryAmendment[] = []
  for (const name of readdirSync(MIG_DIR).sort()) {
    if (!name.endsWith('.sql') || name < seedName) continue
    const code = stripSqlLineComments(readFileSync(join(MIG_DIR, name), 'utf8'))
    const mentions = code.match(/UPDATE\s+projects\.work_item_types\b/g)?.length ?? 0
    const parsed = [...code.matchAll(AMEND_RE)]
    if (parsed.length !== mentions) {
      throw new Error(
        `${name}: ${mentions} UPDATE(s) of projects.work_item_types in code but ${parsed.length} in the single-column form this test models — extend registryAmendments()`,
      )
    }
    for (const m of parsed) {
      const column = m[1] as RegistryAmendment['column']
      if (!AMENDABLE.includes(column)) throw new Error(`${name}: amends work_item_types.${m[1]}, which this test does not model`)
      out.push({ file: name, key: m[4], column, value: m[3] !== undefined ? Number(m[3]) : m[2] })
    }
  }
  return out
}

/** The seed with every amendment applied, in order — what the database holds. */
function applyAmendments(rows: SeedRow[], amendments: RegistryAmendment[]): SeedRow[] {
  const byKey = new Map(rows.map((r) => [r.key, { ...r }]))
  for (const a of amendments) {
    const row = byKey.get(a.key)
    if (!row) throw new Error(`${a.file} amends '${a.key}', which the seed never registered`)
    if (a.column === 'gatekeeper_rule') row.gatekeeperRule = String(a.value)
    else if (a.column === 'calendar') row.calendar = String(a.value)
    else row.days = Number(a.value)
  }
  return [...byKey.values()]
}

/** The column names of CREATE TABLE projects.work_item_types, in DDL order.
 *  A column line is `<name> <type> …`; CONSTRAINT/CHECK lines are upper-case
 *  and never match. */
function ddlColumns(sql: string): string[] {
  const after = sql.split(/CREATE TABLE (?:IF NOT EXISTS )?projects\.work_item_types\s*\(/)[1]
  if (!after) throw new Error('No CREATE TABLE projects.work_item_types in the spine migration')
  const out: string[] = []
  for (const raw of after.split('\n')) {
    const line = raw.replace(/--.*$/, '')
    if (/^\s*\)\s*;/.test(line)) break
    const m = line.match(
      /^\s*([a-z_]+)\s+(?:text(?:\[\])?|int\d?|integer|bigint|smallint|boolean|uuid|timestamptz|timestamp|date|jsonb|numeric)\b/,
    )
    if (m) out.push(m[1])
  }
  return out
}

/** The dollar-quoted body of projects.work_items_ensure_ref(), whatever the tag. */
function ensureRefBody(sql: string): string {
  const m = sql.match(
    /FUNCTION\s+projects\.work_items_ensure_ref\s*\(\)[\s\S]*?\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i,
  )
  if (!m) throw new Error('No CREATE FUNCTION projects.work_items_ensure_ref() body in the spine migration')
  return m[2]
}

/** The prefix CASE inside work_items_ensure_ref(): WHEN 'qc_defect' THEN 'QC' — one arm per
 *  line, anchored to the END of the arm (an optional trailing `--` comment allowed). */
function sqlRefPrefixes(sql: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of ensureRefBody(sql).matchAll(/^\s*WHEN\s+'([a-z_]+)'\s+THEN\s+'([A-Z]+)'\s*(?:--.*)?$/gm)) {
    out[m[1]] = m[2]
  }
  return out
}

/** The CHECK on the `status text` column of projects.work_items. */
function sqlStatusCheck(sql: string): RegExpMatchArray | null {
  const table = sql.split(/CREATE TABLE (?:IF NOT EXISTS )?projects\.work_items\s*\(/)[1]?.split(/^\)\s*;/m)[0]
  if (!table) throw new Error('No CREATE TABLE projects.work_items in the spine migration')
  return table.match(/\bstatus\s+text\b[^,]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i)
}

const SCAN_DIRS = ['apps/web/src', 'packages/shared/src']
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', 'dist', 'build', '.expo'])

function sourceFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const n of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, n.name)
      if (n.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(n.name)) walk(p)
      } else if (/\.(ts|tsx)$/.test(n.name) && !/\.test\.tsx?$/.test(n.name)) {
        files.push(p)
      }
    }
  }
  for (const d of SCAN_DIRS) walk(join(ROOT, d))
  return files
}

/** Comments blanked with line numbers preserved: block comments keep their
 *  newlines; whole-line `//` and doc-continuation `*` lines are emptied. */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => {
      const t = l.trimStart()
      return t.startsWith('//') || t.startsWith('*') ? '' : l
    })
    .join('\n')
}

/** Every quoted item_type literal in application code, in the shapes the codebase uses:
 *    item_type: 'task'  /  item_type = 'task'      (payloads, assignments)
 *    item_type === 'task'  /  item_type !== 'task'  (comparisons)
 *    .eq('item_type', 'task')                        (query filters)
 */
const LITERAL_PATTERNS = [
  /item_type\s*[:=]\s*'([a-z_]+)'/g,
  /item_type\s*[=!]==?\s*'([a-z_]+)'/g,
  /'item_type'\s*,\s*'([a-z_]+)'/g,
]

describe('work-item type registry — A(b) <-> migration <-> TypeScript', () => {
  const { path, sql } = spineMigration()
  const amendments = registryAmendments(path)
  const seeded = applyAmendments(seededRows(sql), amendments)
  const seededKeys = seeded.map((r) => r.key)
  const rel = path.replace(ROOT + '/', '')
  const amendedBy = (key: string, column: RegistryAmendment['column']) =>
    amendments.filter((a) => a.key === key && a.column === column).map((a) => a.file).join(', ') || 'no later migration'

  it('parses a non-empty set from each source (a parser that matched nothing would make every assertion vacuous)', () => {
    expect(appendixQ1Keys().length).toBeGreaterThan(0)
    expect(seeded.length).toBeGreaterThan(0)
    expect(WORK_ITEM_TYPE_KEYS.length).toBeGreaterThan(0)
    expect(Object.keys(sqlRefPrefixes(sql)).length).toBeGreaterThan(0)
    expect(ddlColumns(sql).length).toBeGreaterThan(0)
    expect(appendixColumns().length).toBeGreaterThan(0)
    // 00199 amends rfi.gatekeeper_rule; a parser that matched nothing would let
    // WORK_ITEM_TYPES drift from what the database holds while staying green.
    expect(amendments.length, 'no registry amendment parsed from any migration at or after the seed').toBeGreaterThan(0)
  })

  it('Appendix A(b) Q1 == the migration seed, in both directions', () => {
    expect([...seededKeys].sort(), `seed in ${rel} vs A(b) Q1 rows`).toEqual([...appendixQ1Keys()].sort())
  })

  it('the migration seed == WORK_ITEM_TYPE_KEYS, in both directions', () => {
    expect([...WORK_ITEM_TYPE_KEYS].sort(), `WORK_ITEM_TYPE_KEYS vs seed in ${rel}`).toEqual([...seededKeys].sort())
  })

  it('every type carries the same due offset, calendar, gatekeeper rule and write set in SQL and TypeScript', () => {
    for (const row of seeded) {
      const ts = WORK_ITEM_TYPES.find((t) => t.key === row.key)
      expect(ts, `${row.key} is seeded in ${rel} but missing from WORK_ITEM_TYPES`).toBeDefined()
      expect(ts!.defaultDays, `${row.key} default_days (seed in ${rel}, amended by ${amendedBy(row.key, 'default_days')})`).toBe(row.days)
      expect(ts!.calendar, `${row.key} calendar (seed in ${rel}, amended by ${amendedBy(row.key, 'calendar')})`).toBe(row.calendar)
      expect(ts!.gatekeeperRule, `${row.key} gatekeeper_rule (seed in ${rel}, amended by ${amendedBy(row.key, 'gatekeeper_rule')})`).toBe(row.gatekeeperRule)
      expect([...ts!.writeRoles].sort(), `${row.key} write_roles`).toEqual(row.roles)
    }
  })

  it('every seeded write_roles array IS an existing shared role constant, not an invented list', () => {
    const known: Record<string, readonly string[]> = {
      ORG_WRITE_ROLES, MARKUP_WRITE_ROLES, QC_WRITE_ROLES, SNAG_FIELD_ROLES, FORMS_FIELD_ROLES,
    }
    for (const row of seeded) {
      const match = Object.entries(known).find(
        ([, v]) => JSON.stringify([...v].sort()) === JSON.stringify(row.roles),
      )
      expect(match, `${row.key}'s write_roles [${row.roles}] matches no shared role constant`).toBeDefined()
    }
  })

  it('no type admits client_viewer in Q1 — the Watcher-tier write set lands in Q3', () => {
    for (const row of seeded) expect(row.roles, `${row.key} write_roles`).not.toContain('client_viewer')
  })

  it('the SQL ref-prefix CASE equals REF_PREFIXES, in both directions', () => {
    // `ref` is immutable and travels into emails, PDFs and client deep links
    // (§15 §(e)). Two sources for a permanent identifier is two identifiers.
    expect(sqlRefPrefixes(sql), `work_items_ensure_ref() in ${rel} vs REF_PREFIXES`).toEqual({ ...REF_PREFIXES })
  })

  it('every registered type has a prefix arm — none falls through to upper(item_type)', () => {
    const fromSql = sqlRefPrefixes(sql)
    for (const key of new Set([...seededKeys, ...WORK_ITEM_TYPE_KEYS])) {
      expect(fromSql[key], `${key} has no arm in work_items_ensure_ref()'s CASE (${rel})`).toBeDefined()
    }
  })

  it('every item_type literal in application code is a registered key', () => {
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      const src = stripTsComments(readFileSync(f, 'utf8'))
      for (const re of LITERAL_PATTERNS) {
        re.lastIndex = 0
        for (const m of src.matchAll(re)) {
          if (isWorkItemTypeKey(m[1])) continue
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${f.replace(ROOT + '/', '')}:${line} -> '${m[1]}'`)
        }
      }
    }
    expect(offenders, `unregistered item_type literal(s):\n${offenders.join('\n')}`).toEqual([])
  })

  it('the SQL status CHECK equals WORK_ITEM_STATUSES, in both directions', () => {
    const m = sqlStatusCheck(sql)
    expect(m, `no status CHECK on projects.work_items found in ${rel}`).toBeTruthy()
    const fromSql = [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()
    expect(fromSql.length).toBeGreaterThan(0)
    expect([...WORK_ITEM_STATUSES].sort(), `WORK_ITEM_STATUSES vs the status CHECK in ${rel}`).toEqual(fromSql)
  })

  it('the projects.work_item_types column set is exactly A(b)\'s — no ref_prefix column, nothing missing', () => {
    // A(b) fixes the registry's column set; the prefix deliberately lives in
    // work_items_ensure_ref()'s CASE + REF_PREFIXES, not in a column (§1 of the
    // migration and types.ts both cite this test for that).
    expect([...ddlColumns(sql)].sort(), `CREATE TABLE in ${rel} vs A(b)'s column list`).toEqual([...appendixColumns()].sort())
  })
})
