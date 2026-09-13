import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Contract test: projects.map_source_status must carry an arm for every value
 * in every mirrored source table's own status CHECK, and every non-null result
 * must be a member of the projects.work_items status CHECK.
 *
 * The fixture is the migrations themselves, on both sides. A hardcoded list
 * here would pass forever after someone widened a source CHECK — which is how
 * `photo_type: 'defect'` shipped and produced zero rows in field.snag_photos.
 *
 * Everything is located by CONTENT, never by migration number: the mirror
 * migration is the one that defines map_source_status, the spine is the one
 * that creates projects.work_items, and each source CHECK is read from the
 * migration that declares it.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')
const MIG_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

/** Find a migration by a distinctive string in its BODY, never by filename. */
function migrationContaining(needle: string): string {
  for (const n of readdirSync(MIG_DIR).sort()) {
    const sql = readFileSync(join(MIG_DIR, n), 'utf8')
    if (sql.includes(needle)) return sql
  }
  throw new Error(`no migration contains ${JSON.stringify(needle)}`)
}

const MAP_FN = 'CREATE OR REPLACE FUNCTION projects.map_source_status'
const DIARY_FN = 'CREATE OR REPLACE FUNCTION projects.diary_delay_text'
const SPINE_TABLE = 'CREATE TABLE IF NOT EXISTS projects.work_items ('

const mirrorSql = () => migrationContaining(MAP_FN)
const spineSql = () => migrationContaining(SPINE_TABLE)

/**
 * Blank every `-- …` comment to end of line, leaving string literals alone.
 * A comment that says `WHEN 'foo' THEN` must not count as an arm — the
 * snag-photo-type contract fired on a doc comment for exactly this reason.
 */
function stripSqlComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === "'") {
      // literal: copy through the closing quote ('' is an escaped quote)
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") break
        j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * The body of one `CREATE OR REPLACE FUNCTION …` — from its header to the
 * `$fn$;` that closes it — with comments blanked. Scoped so that a later
 * section of the same migration carrying its own `WHEN 'rfi' THEN` (a
 * projection body, a gatekeeper CASE) can never be mistaken for the map.
 */
function functionBody(sql: string, header: string): string {
  const start = sql.indexOf(header)
  if (start < 0) throw new Error(`function not found: ${header}`)
  const end = sql.indexOf('$fn$;', start)
  if (end < 0) throw new Error(`no $fn$; terminator after ${header}`)
  return stripSqlComments(sql.slice(start, end + 5))
}

/**
 * Values in the `<col> IN (…)` CHECK for `column`, searched ONLY from `anchor`
 * onward. The anchor is mandatory: in 00002_projects_schema.sql the FIRST
 * `CHECK (status IN (…))` is projects.projects at line 20
 * (planning|active|on_hold|completed|cancelled), not projects.rfis at line 90.
 * An unanchored search demands that the rfi arm cover the project vocabulary
 * and fails permanently.
 */
function checkValues(sql: string, anchor: string, column: string): string[] {
  const start = sql.indexOf(anchor)
  if (start < 0) throw new Error(`anchor not found: ${anchor}`)
  const slice = sql.slice(start)
  const re = new RegExp(`${column}[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i')
  const m = slice.match(re)
  if (!m) throw new Error(`no CHECK found for ${column} after ${anchor}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/**
 * The `WHEN '<x>' THEN` arms inside one `WHEN '<type>' THEN CASE …` block of
 * map_source_status. The inner CASE has no nested CASE, so the first `END`
 * after the block opens closes it.
 */
function armsForType(mapBody: string, itemType: string): string[] {
  const open = `WHEN '${itemType}' THEN CASE`
  const start = mapBody.indexOf(open)
  if (start < 0) throw new Error(`map_source_status has no CASE arm for item_type '${itemType}'`)
  const rest = mapBody.slice(start + open.length)
  const end = rest.search(/\bEND\b/)
  const block = rest.slice(0, end < 0 ? rest.length : end)
  return [...block.matchAll(/WHEN\s+'([^']+)'\s+THEN/g)].map((x) => x[1])
}

/**
 * Anchors: every source is anchored on its own `CREATE TABLE <schema>.<table> (`
 * except qc_entries, whose `conformance` column and CHECK were added by
 * 00176's ALTER TABLE, not by 00172's CREATE TABLE — so the anchor there is
 * the named constraint (`qc_entries_conformance_check`), which is unique to
 * that table and that column. The parse-assertion test below pins what each
 * anchor reads, so a drifting anchor fails by name.
 */
const SOURCES = [
  { type: 'rfi',         needle: 'CREATE TABLE projects.rfis (',
    anchor: 'CREATE TABLE projects.rfis (',            column: 'status',
    expect: ['draft', 'open', 'responded', 'closed'] },
  { type: 'snag',        needle: 'CREATE TABLE field.snags (',
    anchor: 'CREATE TABLE field.snags (',              column: 'status',
    expect: ['open', 'in_progress', 'resolved', 'pending_sign_off', 'signed_off', 'closed'] },
  { type: 'inspection',  needle: 'CREATE TABLE inspections.inspections (',
    anchor: 'CREATE TABLE inspections.inspections (',  column: 'status',
    expect: ['assigned', 'in_progress', 'awaiting_verification', 'certified',
             're-inspect_required', 'abandoned'] },
  { type: 'qc_defect',   needle: 'ADD  CONSTRAINT qc_entries_conformance_check',
    anchor: 'ADD  CONSTRAINT qc_entries_conformance_check', column: 'conformance',
    expect: ['pass', 'fail', 'na'] },
  { type: 'form_action', needle: 'CREATE TABLE field.site_forms (',
    anchor: 'CREATE TABLE field.site_forms (',         column: 'status',
    expect: ['draft', 'submitted', 'distributed', 'void'] },
] as const

describe('map_source_status covers every source vocabulary', () => {
  for (const s of SOURCES) {
    it(`${s.type}: the parser reads the right CHECK`, () => {
      // Assert the PARSE before comparing it to anything. An anchor that
      // silently matched the wrong table would otherwise make the next test
      // pass or fail for a reason that has nothing to do with the mapping.
      const values = checkValues(migrationContaining(s.needle), s.anchor, s.column)
      expect(values.sort()).toEqual([...s.expect].sort())
    })

    it(`${s.type}: every value in the source CHECK has an arm`, () => {
      const values = checkValues(migrationContaining(s.needle), s.anchor, s.column)
      const arms = armsForType(functionBody(mirrorSql(), MAP_FN), s.type)
      const missing = values.filter((v) => !arms.includes(v))
      expect(missing, `${s.type} has no arm for: ${missing.join(', ')}`).toEqual([])
    })
  }

  it('diary_action is mapped to NULL unconditionally (the source has no status column)', () => {
    expect(functionBody(mirrorSql(), MAP_FN)).toMatch(/WHEN 'diary_action' THEN NULL/)
  })

  it('every mapped result is a member of the work_items status CHECK', () => {
    const universal = checkValues(spineSql(), SPINE_TABLE, 'status')
    expect(universal.sort()).toEqual(['answered', 'closed', 'open', 'triage', 'void'])
    const body = functionBody(mirrorSql(), MAP_FN)
    const produced = [...body.matchAll(/WHEN\s+'[^']+'\s+THEN\s+'([a-z_]+)'/g)].map((x) => x[1])
    expect(produced.length, 'the map produces no literal states at all — the parser is reading nothing').toBeGreaterThan(0)
    const rogue = [...new Set(produced)].filter((p) => !universal.includes(p))
    expect(rogue, `map_source_status produces non-universal states: ${rogue.join(', ')}`).toEqual([])
  })

  it('the diary negation stop-list exists and covers every live value', () => {
    const sql = mirrorSql()
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION projects\.diary_delay_text/)
    const body = functionBody(sql, DIARY_FN)
    for (const token of ['none', 'no', 'n/a', 'na', 'nil', 'nothing']) {
      expect(
        body,
        `diary_delay_text must stop-list ${JSON.stringify(token)} — all 6 of 6 live ` +
        `site_diary_entries "delays" values are negations (measured 2026-09-10, re-read 2026-09-13)`,
      ).toContain(`'${token}'`)
    }
    // The 2026-06-02 entry is a sentence, so the token list alone is not enough.
    expect(body).toMatch(/\^\(no\|none\|nil\|nothing\)/)
  })
})
