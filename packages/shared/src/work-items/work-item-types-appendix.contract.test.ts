import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { GATEKEEPER_RULES, WORK_ITEM_CALENDARS } from './types'

/**
 * §12 §(h) test 1, third edge: Appendix A(b)'s PROSE TABLE <-> the registry the
 * migrations declare.
 *
 * work-item-types.contract.test.ts pins the SQL seed against WORK_ITEM_TYPES,
 * and reads A(b) only for its Q1 KEY SET and its column list. The per-type
 * CELLS — gatekeeper rule, days to respond, calendar — are not in that pair, so
 * prose can go stale against the database with the whole suite green. It did:
 * on 2026-09-15 a review found A(b)'s `rfi` Gatekeeper cell (and a sentence in
 * §03) still saying "project PM" after item 3's migration amended the row to
 * `gatekeeper_rule = 'creator'`. The registry row is the system of record; the
 * prose is what people read when deciding behaviour, so a divergence is a
 * behaviour bug with no failing test in front of it. This file is that test.
 *
 * Resolution is AMENDMENT-AWARE, exactly as the sibling's seed<->TypeScript
 * comparison is: the declared registry is the seed with every later
 * migration's `UPDATE projects.work_item_types SET … WHERE key = …` applied in
 * migration order. Both sources are read off disk — the migrations DIRECTORY,
 * not a pinned number — so this file is correct both before and after item 3's
 * branch lands, and survives the renumbers that branch has already taken
 * (00198 -> 00199 -> 00202).
 *
 * What this does NOT prove, stated so nobody reads more into a green run than
 * is there: it compares A(b) against the migrations AS WRITTEN, and never reads
 * applied state. A migration can sit on main unapplied, or strand below the
 * ledger head and never apply at all — on 2026-09-18 four Q1 PRs held four
 * consecutive numbers with no ordering authority between them. In that window
 * the files declare one registry and production holds another, and this test
 * speaks for the files. Proving the ledger agrees is a different job, done
 * against a real database by scripts/verify-migration-applied.ts and the
 * `-- @verify:` block every migration >= 00185 carries.
 *
 * Deliberately a sibling, and deliberately holding its own parsers: item 3's
 * unmerged branch rewrites the very hunks of the sibling this would otherwise
 * edit. Two independent readers of the same two source texts cross-check each
 * other; if they ever disagree about the seed, one of them is wrong and both
 * fail loudly. Folding them together is a follow-up for after item 3 merges.
 *
 * Parsing notes (each is a real property of the source text, checked):
 *   - A(b)'s header is asserted CELL BY CELL against the classification below,
 *     so a column added to, removed from or renamed in the table fails here
 *     rather than being silently ignored by a row parser that just indexes 6.
 *   - Columns with no registry counterpart (`Quarter`, `Default assignee when
 *     unnamed`) are declared as such and skipped by name. Nothing is mapped by
 *     resemblance.
 *   - A Gatekeeper cell that states the machine value (`gatekeeper_rule =
 *     'creator'`) is read from that token; otherwise the cell must be one of a
 *     closed set of PHRASES. The explicit token wins, because item 3's cell
 *     also contains the words "the project PM" in its explanation and a loose
 *     phrase scan would resolve it to exactly the stale value this test exists
 *     to catch.
 *   - An unrecognised cell THROWS, naming the file, the key, the column and
 *     the cell. Silently skipping what it cannot parse is how a contract test
 *     becomes decorative.
 */

// packages/shared/src/work-items -> repo root
const ROOT = resolve(__dirname, '../../../..')
const APPENDIX_REL = 'docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md'
const APPENDIX = join(ROOT, APPENDIX_REL)
const MIG_DIR = join(ROOT, 'apps/edge-functions/supabase/migrations')

const SEED_NEEDLE = 'INSERT INTO projects.work_item_types'

// ─── the registry, as the migrations declare it ──────────────────────────────

/** `--` line comments blanked. Applied before every SQL match in this file:
 *  the migration that amends `rfi` also carries the ROLLBACK statement — the
 *  same UPDATE with the old value — inside its header comment. */
function stripSqlLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/** The migration that seeds the registry, located by CONTENT not by number. */
function spineMigration(): { name: string; sql: string } {
  for (const name of readdirSync(MIG_DIR).sort()) {
    if (!name.endsWith('.sql')) continue
    const sql = readFileSync(join(MIG_DIR, name), 'utf8')
    if (stripSqlLineComments(sql).includes(SEED_NEEDLE)) return { name, sql }
  }
  throw new Error(`No migration seeds projects.work_item_types (no file in ${MIG_DIR} contains "${SEED_NEEDLE}")`)
}

interface RegistryRow {
  key: string
  sourceTable: string | null
  days: number
  calendar: string
  gatekeeperRule: string
}

/** The seeded VALUES rows:
 *  ('rfi', 'RFI', 'projects.rfis', 'assigned_to', 7, 'office', 'project_pm', ARRAY[…], 1)
 *  Bounded on the statement itself (ON CONFLICT or the terminating ';'), so the
 *  row regex cannot wander into a later VALUES list. */
function seededRows(sql: string): RegistryRow[] {
  const after = sql.split(SEED_NEEDLE)[1] ?? ''
  const end = after.search(/ON CONFLICT|;/)
  const block = end === -1 ? after : after.slice(0, end)
  const rows = [...block.matchAll(
    /\(\s*'([a-z_]+)'\s*,\s*'[^']*'\s*,\s*(?:'([a-z_.]+)'|NULL)\s*,\s*(?:'[a-z_]+'|NULL)\s*,\s*(\d+)\s*,\s*'([a-z]+)'\s*,\s*'([a-z_]+)'\s*,\s*ARRAY\[/g,
  )].map((m) => ({
    key: m[1],
    sourceTable: m[2] ?? null,
    days: Number(m[3]),
    calendar: m[4],
    gatekeeperRule: m[5],
  }))
  if (rows.length === 0) throw new Error(`Parsed no VALUES rows out of the seed in the spine migration`)
  return rows
}

interface Amendment {
  file: string
  key: string
  column: 'gatekeeper_rule' | 'calendar' | 'default_days' | 'source_table'
  value: string | number | null
}

const AMENDABLE: readonly Amendment['column'][] = ['gatekeeper_rule', 'calendar', 'default_days', 'source_table']

/** UPDATE projects.work_item_types SET <col> = '<text>' | <n> | NULL WHERE key = '<key>'; */
const AMEND_RE =
  /UPDATE\s+projects\.work_item_types\s+SET\s+([a-z_]+)\s*=\s*(?:'([a-z_.]+)'|(\d+)|(NULL))\s+WHERE\s+key\s*=\s*'([a-z_]+)'\s*;/g

/**
 * Every in-place amendment of a seeded row, from every migration sorting at or
 * after the seed's, in file order.
 *
 * Every UPDATE of the registry that survives comment-stripping must match the
 * single-column, single-key form, or this THROWS. An amendment shape the test
 * cannot model is a reason to extend it — never a reason to resolve the row to
 * a value the database does not hold and report that as agreement.
 */
function registryAmendments(seedName: string): Amendment[] {
  const out: Amendment[] = []
  for (const name of readdirSync(MIG_DIR).sort()) {
    if (!name.endsWith('.sql') || name < seedName) continue
    const code = stripSqlLineComments(readFileSync(join(MIG_DIR, name), 'utf8'))
    const mentions = code.match(/UPDATE\s+projects\.work_item_types\b/g)?.length ?? 0
    const parsed = [...code.matchAll(AMEND_RE)]
    if (parsed.length !== mentions) {
      throw new Error(
        `${name}: ${mentions} UPDATE(s) of projects.work_item_types in code but ${parsed.length} in the single-column ` +
          `form this test models — extend registryAmendments() in work-item-types-appendix.contract.test.ts`,
      )
    }
    for (const m of parsed) {
      const column = m[1] as Amendment['column']
      if (!AMENDABLE.includes(column)) {
        throw new Error(`${name}: amends work_item_types.${m[1]}, a column this test does not model — extend AMENDABLE`)
      }
      const value = m[4] ? null : m[3] !== undefined ? Number(m[3]) : m[2]
      out.push({ file: name, key: m[5], column, value })
    }
  }
  return out
}

/** The seed with every amendment applied in migration order — the declared registry. */
function applyAmendments(rows: RegistryRow[], amendments: Amendment[]): RegistryRow[] {
  const byKey = new Map(rows.map((r) => [r.key, { ...r }]))
  for (const a of amendments) {
    const row = byKey.get(a.key)
    if (!row) throw new Error(`${a.file} amends '${a.key}', which the seed never registered`)
    if (a.column === 'gatekeeper_rule') row.gatekeeperRule = String(a.value)
    else if (a.column === 'calendar') row.calendar = String(a.value)
    else if (a.column === 'default_days') row.days = Number(a.value)
    else row.sourceTable = a.value === null ? null : String(a.value)
  }
  return [...byKey.values()]
}

// ─── Appendix A(b), as prose ─────────────────────────────────────────────────

/**
 * A(b)'s columns, and what each one is a statement ABOUT.
 *
 * `null` means the column has no counterpart in projects.work_item_types, and
 * is therefore skipped rather than mapped onto a column it merely resembles:
 *   - `Quarter` is which quarter's migration first registers the type. It is a
 *     property of the ledger (A(f)), not a column; the sibling test uses it to
 *     select the Q1 rows and nothing asserts it against the database.
 *   - `Default assignee when unnamed` is the seed-assignee rule each item-3
 *     projection trigger implements in its own body. The registry carries
 *     `source_column`, which is a different statement (the source's owner
 *     column), and A(b) has no cell for it.
 *
 * The header is asserted against these keys in order, so a column added to,
 * removed from or renamed in A(b) fails this test and forces the same decision
 * to be taken again.
 */
const A_B_COLUMNS: ReadonlyArray<readonly [header: string, column: keyof RegistryRow | null]> = [
  ['Key', 'key'],
  ['Quarter', null],
  ['Source', 'sourceTable'],
  ['Default due', 'days'],
  ['Calendar', 'calendar'],
  ['Default assignee when unnamed', null],
  ['Gatekeeper', 'gatekeeperRule'],
]

/** The text between the `### A(b)` and `### A(c)` headings. */
function appendixAb(): string {
  const md = readFileSync(APPENDIX, 'utf8')
  const block = md.split('### A(b)')[1]?.split('### A(c)')[0]
  if (!block) throw new Error(`Could not locate the "### A(b)" … "### A(c)" block in ${APPENDIX_REL}`)
  return block
}

/** A(b)'s markdown table: the contiguous run of `|`-leading lines. The footnote
 *  under it is a `>` blockquote and the notes are paragraphs, so neither can be
 *  mistaken for a row. */
function appendixTable(): { header: string[]; rows: string[][] } {
  const lines = appendixAb().split('\n')
  const start = lines.findIndex((l) => l.trimStart().startsWith('|'))
  if (start === -1) throw new Error(`A(b) in ${APPENDIX_REL} no longer contains a markdown table`)
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const table: string[][] = []
  for (let i = start; i < lines.length && lines[i].trimStart().startsWith('|'); i++) table.push(cells(lines[i]))
  const [header, separator, ...rows] = table
  if (!separator?.every((c) => /^:?-{2,}:?$/.test(c))) {
    throw new Error(`A(b)'s table in ${APPENDIX_REL} has no |---| separator row under its header`)
  }
  for (const r of rows) {
    if (r.length !== header.length) {
      throw new Error(`A(b) row [${r[0]}] has ${r.length} cells, header has ${header.length} — a cell contains a raw "|"?`)
    }
  }
  return { header, rows }
}

/** Backticks and footnote superscripts dropped, whitespace collapsed, lower-cased. */
function normalise(cell: string): string {
  return cell.replace(/[`*]/g, '').replace(/[¹²³⁰-₟]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The closed set of Gatekeeper phrases, and the `gatekeeper_rule` each one
 * states. A GLOSSARY, keyed by phrase — never by type key — so it cannot
 * quietly encode "whatever `rfi` happens to say today": rewording `rfi`'s cell
 * from one entry to another still moves the resolved value, and the assertion
 * still bites.
 */
const GATEKEEPER_PHRASES: Readonly<Record<string, string>> = {
  'project pm': 'project_pm',
  'verifier_id, else pm': 'verifier_else_pm',
  creator: 'creator',
}

function fail(key: string, column: string, cell: string, why: string): never {
  throw new Error(`${APPENDIX_REL} — A(b) row \`${key}\`, column "${column}": ${why}\n  cell: ${cell}`)
}

/** `project PM` -> project_pm. A cell STATING the machine value wins outright:
 *  item 3's `rfi` cell explains the rule in words that include "the project
 *  PM" and then names `gatekeeper_rule = 'creator'`, which is the value the
 *  migration declares. */
function resolveGatekeeper(key: string, cell: string): string {
  const explicit = cell.match(/gatekeeper_rule\s*=\s*'([a-z_]+)'/)
  const rule = explicit ? explicit[1] : GATEKEEPER_PHRASES[normalise(cell)]
  if (!rule) {
    fail(key, 'Gatekeeper', cell,
      `states neither an explicit \`gatekeeper_rule = '…'\` nor one of the known phrases ` +
      `[${Object.keys(GATEKEEPER_PHRASES).map((p) => `"${p}"`).join(', ')}]. ` +
      `Add the new wording to GATEKEEPER_PHRASES, or state the machine value in the cell.`)
  }
  if (!(GATEKEEPER_RULES as readonly string[]).includes(rule)) {
    fail(key, 'Gatekeeper', cell, `resolves to '${rule}', which is not a GATEKEEPER_RULES value [${GATEKEEPER_RULES.join(', ')}]`)
  }
  return rule
}

/** `+7 wd` -> 7. Q1 rows only; Q2+ carry source-dated forms (`respond_by`,
 *  `valuation date +5 wd`) that have no `default_days` counterpart yet. */
function resolveDays(key: string, cell: string): number {
  const m = normalise(cell).match(/^\+(\d+) wd$/)
  if (!m) fail(key, 'Default due', cell, 'is not of the form `+<n> wd`')
  return Number(m[1])
}

function resolveCalendar(key: string, cell: string): string {
  const v = normalise(cell)
  if (!(WORK_ITEM_CALENDARS as readonly string[]).includes(v)) {
    fail(key, 'Calendar', cell, `is not one of [${WORK_ITEM_CALENDARS.join(', ')}]`)
  }
  return v
}

/** The LEADING backticked identifier is the source table; `none (sourceless…)`
 *  is a NULL source. The trailing prose (scope predicates, the order-line
 *  caveat) qualifies WHEN a row is projected and has no registry counterpart. */
function resolveSourceTable(key: string, cell: string): string | null {
  if (/^none\b/i.test(cell.trim())) return null
  const m = cell.trim().match(/^`([a-z_]+\.[a-z_]+)`/)
  if (!m) fail(key, 'Source', cell, 'does not begin with a backticked `schema.table` and does not begin with "none"')
  return m[1]
}

interface AppendixRow {
  key: string
  quarter: string
  resolved: Omit<RegistryRow, 'key'>
}

/** A(b)'s Q1 rows, resolved to the registry values each cell states. */
function appendixQ1Rows(): AppendixRow[] {
  const { header, rows } = appendixTable()
  const idx = (name: string) => {
    const i = header.indexOf(name)
    // Never index a row at -1: a dropped or renamed column must name itself,
    // not surface later as "cannot read properties of undefined".
    if (i === -1) {
      throw new Error(
        `${APPENDIX_REL} — A(b)'s table has no "${name}" column (header: ${header.join(' | ')}). ` +
          `If the column was renamed or removed, update A_B_COLUMNS in work-item-types-appendix.contract.test.ts.`,
      )
    }
    return i
  }
  return rows
    .filter((r) => r[idx('Quarter')] === 'Q1')
    .map((r) => {
      const raw = r[idx('Key')]
      const km = raw.match(/^`([a-z_]+)`$/)
      if (!km) throw new Error(`${APPENDIX_REL} — A(b) Key cell ${raw} is not a single backticked key`)
      const key = km[1]
      return {
        key,
        quarter: 'Q1',
        resolved: {
          sourceTable: resolveSourceTable(key, r[idx('Source')]),
          days: resolveDays(key, r[idx('Default due')]),
          calendar: resolveCalendar(key, r[idx('Calendar')]),
          gatekeeperRule: resolveGatekeeper(key, r[idx('Gatekeeper')]),
        },
      }
    })
}

// ─── the test ────────────────────────────────────────────────────────────────

describe('work-item type registry — Appendix A(b) prose <-> the registry the migrations declare', () => {
  const { name: seedName, sql } = spineMigration()
  const amendments = registryAmendments(seedName)
  const registry = applyAmendments(seededRows(sql), amendments)
  const seedRel = `apps/edge-functions/supabase/migrations/${seedName}`
  // Both sources parsed ONCE, here, so an unreadable cell reports itself a
  // single time at collection rather than four identical times across the
  // value assertions. The sibling hoists its migration parse the same way.
  const appendixHeader = appendixTable().header
  const prose = appendixQ1Rows()
  const proseByKey = new Map(prose.map((r) => [r.key, r.resolved]))

  /** A(b)'s cells for a registered key. A key present in the registry and
   *  absent from A(b) names itself here rather than surfacing as an undefined
   *  property read three assertions later. */
  const cellsFor = (key: string) => {
    const c = proseByKey.get(key)
    if (!c) throw new Error(`${key} is registered in ${seedRel} but has no Q1 row in A(b) — ${APPENDIX_REL}`)
    return c
  }

  /** "the seed in 00196_…" / "the seed in 00196_… as amended by 00202_…". */
  const provenance = (key: string, column: Amendment['column']) => {
    const by = amendments.filter((a) => a.key === key && a.column === column).map((a) => a.file)
    return by.length ? `${seedRel} as amended by ${by.join(', ')}` : seedRel
  }

  it('parses a non-empty set from each source (a parser that matched nothing would make every assertion vacuous)', () => {
    expect(registry.length, 'no rows parsed out of the registry seed').toBeGreaterThan(0)
    expect(prose.length, `no Q1 rows parsed out of A(b) in ${APPENDIX_REL}`).toBeGreaterThan(0)
    expect(appendixHeader.length, 'A(b) table header is empty').toBeGreaterThan(0)
  })

  it("A(b)'s table header is exactly the column set this test has classified", () => {
    // Renaming, adding or dropping a column silently would let a new prose
    // statement about the registry ship with nothing checking it.
    expect(appendixHeader, `A(b) columns in ${APPENDIX_REL} vs A_B_COLUMNS`).toEqual(A_B_COLUMNS.map(([h]) => h))
  })

  it('every A(b) column is either mapped to a registry column or declared as having none', () => {
    const mapped = A_B_COLUMNS.filter(([, c]) => c !== null).map(([h]) => h)
    const skipped = A_B_COLUMNS.filter(([, c]) => c === null).map(([h]) => h)
    // Stated, so the split is a decision on the record rather than an omission.
    expect(mapped).toEqual(['Key', 'Source', 'Default due', 'Calendar', 'Gatekeeper'])
    expect(skipped, 'columns with no projects.work_item_types counterpart').toEqual([
      'Quarter',
      'Default assignee when unnamed',
    ])
  })

  it("A(b)'s Q1 rows are exactly the registry's rows, in both directions", () => {
    expect([...prose.map((r) => r.key)].sort(), `A(b) Q1 rows vs the seed in ${seedRel}`)
      .toEqual([...registry.map((r) => r.key)].sort())
  })

  it('every A(b) Gatekeeper cell states the gatekeeper_rule the migrations declare', () => {
    for (const row of registry) {
      const cells = cellsFor(row.key)
      expect(
        cells.gatekeeperRule,
        `A(b) row \`${row.key}\` Gatekeeper reads '${cells.gatekeeperRule}', ` +
          `the migrations declare '${row.gatekeeperRule}' (${provenance(row.key, 'gatekeeper_rule')}) ` +
          `— ${APPENDIX_REL}`,
      ).toBe(row.gatekeeperRule)
    }
  })

  it('every A(b) Default due cell states the default_days the migrations declare', () => {
    for (const row of registry) {
      const cells = cellsFor(row.key)
      expect(
        cells.days,
        `A(b) row \`${row.key}\` Default due reads +${cells.days} wd, ` +
          `the migrations declare ${row.days} (${provenance(row.key, 'default_days')}) — ${APPENDIX_REL}`,
      ).toBe(row.days)
    }
  })

  it('every A(b) Calendar cell states the calendar the migrations declare', () => {
    for (const row of registry) {
      const cells = cellsFor(row.key)
      expect(
        cells.calendar,
        `A(b) row \`${row.key}\` Calendar reads '${cells.calendar}', ` +
          `the migrations declare '${row.calendar}' (${provenance(row.key, 'calendar')}) — ${APPENDIX_REL}`,
      ).toBe(row.calendar)
    }
  })

  it('every A(b) Source cell names the source_table the migrations declare', () => {
    for (const row of registry) {
      const cells = cellsFor(row.key)
      expect(
        cells.sourceTable,
        `A(b) row \`${row.key}\` Source names '${cells.sourceTable}', ` +
          `the migrations declare '${row.sourceTable}' (${provenance(row.key, 'source_table')}) — ${APPENDIX_REL}`,
      ).toBe(row.sourceTable)
    }
  })

  it('the registry is resolved as amended — a later migration UPDATE is applied, not ignored', () => {
    // No assertion that amendments EXIST: on origin/main there are none, and
    // this file has to be correct before item 3 lands as well as after. What is
    // asserted is that each amendment landed on a real row and moved it, so an
    // amendment that parses but does nothing cannot pass for resolution.
    for (const a of amendments) {
      const row = registry.find((r) => r.key === a.key)
      expect(row, `${a.file} amends '${a.key}', which is not in the registry`).toBeDefined()
      const held =
        a.column === 'gatekeeper_rule' ? row!.gatekeeperRule
        : a.column === 'calendar' ? row!.calendar
        : a.column === 'default_days' ? row!.days
        : row!.sourceTable
      expect(held, `${a.file}'s amendment of ${a.key}.${a.column} did not survive into the resolved registry`)
        .toBe(a.value)
    }
  })
})
