/**
 * CONTRACT — the programme schema carries the site_scope text the generator
 * would emit, for every programme table that has a project_id.
 *
 * Since 00238 every site table has a RESTRICTIVE site_scope policy generated
 * from packages/db/src/site-scope/manifest.ts. Tables created after 00238 carry
 * that policy in their own migration. Hand-copying it is how the two drift, so
 * this test regenerates the text from the manifest and demands the migration
 * contain it byte for byte (the status-plans / tenant-plans precedent).
 *
 * The list of tables is DERIVED from the migration's own CREATE TABLE bodies,
 * not re-typed here: a programme table added later with a project_id and no
 * manifest entry fails this test by name.
 *
 * The migration is found by name pattern, not number, so a renumber at apply
 * time does not break this test.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMigration } from '../../site-scope/generate'
import { GATED } from '../../site-scope/manifest'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')

function programmeMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_programme_schema\.sql$/.test(f))
  expect(files, 'exactly one <number>_programme_schema.sql migration').toHaveLength(1)
  return readFileSync(join(MIGRATIONS_DIR, files[0]!), 'utf8')
}

/** programme tables, and whether each CREATE TABLE body declares a project_id column. */
function programmeTables(sql: string): { table: string; hasProjectId: boolean }[] {
  const out: { table: string; hasProjectId: boolean }[] = []
  const re = /^CREATE TABLE (programme\.[a-z_]+) \(\n([\s\S]*?)\n\);/gm
  for (const m of sql.matchAll(re)) {
    out.push({ table: m[1]!, hasProjectId: /^\s+project_id\s/m.test(m[2]!) })
  }
  return out
}

/** The generator's DROP + CREATE POLICY text for one table, through the WITH CHECK semicolon. */
function generatedPolicy(sql: string, table: string): string {
  const start = sql.indexOf(`DROP POLICY IF EXISTS site_scope ON ${table};`)
  expect(start, `generator emits no site_scope for ${table}: add it to the manifest`).toBeGreaterThan(-1)
  const withCheck = sql.indexOf('WITH CHECK (', start)
  const end = sql.indexOf(';', withCheck)
  return sql.slice(start, end + 1)
}

describe('programme site_scope matches the generator', () => {
  const generated = generateMigration()
  const migration = programmeMigration()
  const tables = programmeTables(migration)
  const withProject = tables.filter((t) => t.hasProjectId).map((t) => t.table)

  it('finds the programme tables in the migration (the parse is not vacuous)', () => {
    expect(tables.length).toBe(21)
    expect(withProject.length).toBe(19)
    expect(tables.filter((t) => !t.hasProjectId).map((t) => t.table).sort()).toEqual([
      'programme.resource_rates',
      'programme.resources',
    ])
  })

  it('the manifest gates every programme table with a project_id, by its own project_id', () => {
    for (const t of withProject) {
      const g = GATED.find((x) => x.table === t)
      expect(g, `${t} has a project_id and is not in GATED`).toBeDefined()
      expect(g!.project, t).toEqual({ column: 'project_id' })
    }
  })

  it('the manifest gates no programme table without a project_id', () => {
    const gated = GATED.map((g) => g.table)
    expect(gated).not.toContain('programme.resources')
    expect(gated).not.toContain('programme.resource_rates')
  })

  for (const t of [
    'programme.programmes', 'programme.calendars', 'programme.calendar_exceptions', 'programme.activities',
    'programme.dependencies', 'programme.code_types', 'programme.code_values', 'programme.activity_codes',
    'programme.resource_assignments', 'programme.assignment_costs', 'programme.baselines',
    'programme.baseline_activities', 'programme.baseline_dependencies', 'programme.baseline_costs',
    'programme.progress_periods', 'programme.progress_period_costs', 'programme.field_updates',
    'programme.imports', 'programme.audit',
  ]) {
    it(`${t}: the migration carries the site_scope policy text byte for byte`, () => {
      expect(withProject, `${t} is no longer a project_id table in the migration`).toContain(t)
      expect(migration).toContain(generatedPolicy(generated, t))
    })
  }

  it('can fail: a table the migration does not create is not found in it', () => {
    expect(migration).not.toContain(generatedPolicy(generated, 'tenants.status_plans'))
  })
})
