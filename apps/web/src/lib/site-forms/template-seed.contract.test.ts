import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import template from '../../../../../packages/shared/src/site-forms/templates/termination-and-making-safe.json'

/**
 * Contract test: migration 00180 must seed EXACTLY the template JSON that the
 * application code imports.
 *
 * The seed is a ~300-field JSON document copied into a dollar-quoted block in
 * SQL. Two copies of the same document in two languages is a drift machine: the
 * JSON gets a field added in a normal PR, the SQL does not, and from then on the
 * renderer asks for a field the database has never heard of — on a safety record
 * whose whole value is that it is complete. Nothing else in the build would
 * notice, because the SQL is never type-checked and the JSON is never executed.
 *
 * So this test reads the migration off disk, pulls the text back out of the
 * $seed$ delimiters, and asserts a deep equality against the imported JSON. It
 * additionally pins the row's identity columns (organisation_id NULL = system
 * template, and the version string) against the JSON, because a seed that is
 * byte-perfect but filed under the wrong version is just as broken.
 */

/**
 * Walk up from this file until the migrations directory appears, rather than
 * counting `..` segments — the test runs with cwd = apps/web, and a hardcoded
 * depth breaks silently the moment the file moves.
 */
function findRepoRoot(): string {
  let dir = __dirname
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'apps/edge-functions/supabase/migrations'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not locate the repo root walking up from ${__dirname}`)
}

const REPO_ROOT = findRepoRoot()
const MIGRATION = join(
  REPO_ROOT,
  'apps/edge-functions/supabase/migrations/00180_site_forms_template_seed.sql',
)
const TEMPLATE_JSON = resolve(
  __dirname,
  '../../../../../packages/shared/src/site-forms/templates/termination-and-making-safe.json',
)

/**
 * Anchored on the `::jsonb` cast, not on the opening delimiter alone: a lazy
 * match from a bare delimiter happily starts inside a SQL comment that merely
 * mentions one, and then swallows the entire payload. (It did, on the first run
 * of this test — the migration header used to name the delimiter in prose.)
 */
const DELIM = '$seed$'
const SEED_DELIMITED = /\$seed\$([\s\S]*?)\$seed\$::jsonb/

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8')
}

/** The raw text between the delimiters, exactly as Postgres would see it. */
function seedBlock(sql: string): string {
  const occurrences = sql.split(DELIM).length - 1
  if (occurrences !== 2) {
    throw new Error(
      `Expected exactly 2 '${DELIM}' delimiters in the migration, found ${occurrences}. ` +
        'A third occurrence (even in a comment) makes the seed block unparseable, ' +
        'and one inside the JSON payload would terminate the literal early in Postgres.',
    )
  }
  const m = sql.match(SEED_DELIMITED)
  if (!m) {
    throw new Error(
      'No dollar-quoted seed block cast to ::jsonb found in 00180_site_forms_template_seed.sql',
    )
  }
  return m[1]
}

/**
 * Strip `--` comments so prose about the seed cannot be mistaken for the seed.
 * The dollar-quoted block is lifted out FIRST and replaced with a marker token,
 * because the JSON payload is not SQL and must never be comment-scanned (the
 * lesson from the snag photo_type contract test, where a literal inside a doc
 * comment produced a false positive — here it would be a `--` inside JSON prose
 * silently truncating the statement we are trying to parse).
 */
const SEED_TOKEN = '__SEED_BLOCK__'

function sqlWithoutSeed(sql: string): string {
  return sql
    .replace(SEED_DELIMITED, () => `${SEED_TOKEN}::jsonb`)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

/**
 * Parse the INSERT into a { column: value } map, so the assertions below are
 * driven by the declared column order rather than by counting commas.
 * Values are NULL, a single-quoted literal (with '' escaping), a boolean, or
 * the seed marker.
 */
function parsedInsert(): Record<string, string | boolean | null> {
  const stripped = sqlWithoutSeed(migrationSql())
  const m = stripped.match(
    /INSERT\s+INTO\s+field\.form_templates\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON\s+CONFLICT/i,
  )
  if (!m) throw new Error('Could not parse the INSERT INTO field.form_templates statement')

  const columns = m[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

  const values: Array<string | boolean | null> = []
  const scanner = new RegExp(
    `NULL|TRUE|FALSE|${SEED_TOKEN}(?:::jsonb)?|'((?:[^']|'')*)'`,
    'gi',
  )
  for (const tok of m[2].matchAll(scanner)) {
    const raw = tok[0]
    if (/^null$/i.test(raw)) values.push(null)
    else if (/^true$/i.test(raw)) values.push(true)
    else if (/^false$/i.test(raw)) values.push(false)
    else if (raw.startsWith(SEED_TOKEN)) values.push(SEED_TOKEN)
    else values.push(tok[1].replace(/''/g, "'"))
  }

  if (columns.length !== values.length) {
    throw new Error(
      `INSERT column/value mismatch: ${columns.length} columns vs ${values.length} values ` +
        `(${columns.join(', ')})`,
    )
  }
  return Object.fromEntries(columns.map((c, i) => [c, values[i]]))
}

describe('00180 site-form template seed contract', () => {
  it('seeds the JSON file byte-for-byte (the seed and the source cannot drift)', () => {
    const seeded = JSON.parse(seedBlock(migrationSql()))
    expect(
      seeded,
      'The $seed$ block in 00180_site_forms_template_seed.sql no longer matches ' +
        'packages/shared/src/site-forms/templates/termination-and-making-safe.json. ' +
        'Never hand-edit the SQL: regenerate the block from the JSON file.',
    ).toEqual(template)
  })

  it('the seeded text is the JSON file itself, not a re-serialisation of it', () => {
    // Deep equality alone would pass on a reformatted copy. Postgres normalises
    // jsonb anyway, but an exact match is what proves the block was generated.
    const onDisk = readFileSync(TEMPLATE_JSON, 'utf8').trim()
    expect(seedBlock(migrationSql())).toBe(onDisk)
  })

  it('seeds a SYSTEM template: organisation_id is NULL', () => {
    const row = parsedInsert()
    expect(Object.keys(row)).toContain('organisation_id')
    expect(
      row.organisation_id,
      'organisation_id must be NULL. A non-NULL value scopes the template to a ' +
        'single organisation, and form_templates_select would hide it from every ' +
        'other tenant.',
    ).toBeNull()
  })

  it('the version in the SQL matches the version inside the JSON', () => {
    const row = parsedInsert()
    expect(template.version).toBeTruthy()
    expect(
      row.version,
      'The seeded version column and schema_json.version disagree. The row would ' +
        'be filed under a version the document does not claim, and 00179 makes ' +
        'schema_json immutable so it cannot be corrected in place.',
    ).toBe(template.version)
  })

  it('the identity columns agree with the JSON document', () => {
    const row = parsedInsert()
    expect(row.template_key).toBe(template.template_id)
    expect(row.name).toBe(template.name)
    expect(row.is_active).toBe(true)
  })

  it('the description states this is not a Certificate of Compliance', () => {
    const description = String(parsedInsert().description ?? '')
    expect(description.length).toBeGreaterThan(0)
    expect(description).toMatch(/certificate of compliance|\bCoC\b/i)
    expect(description).toMatch(/\bnot\b/i)
  })

  it('is safe to re-apply and reloads the schema cache', () => {
    const sql = sqlWithoutSeed(migrationSql())
    expect(sql).toMatch(/ON\s+CONFLICT\s+DO\s+NOTHING/i)
    expect(sql).toMatch(/^\s*BEGIN;/m)
    expect(sql).toMatch(/^\s*COMMIT;/m)
    // NOTIFY must sit AFTER the COMMIT (it is a no-op inside a rolled-back tx).
    expect(sql.indexOf("NOTIFY pgrst, 'reload schema'")).toBeGreaterThan(sql.indexOf('COMMIT;'))
  })
})
