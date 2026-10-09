/**
 * CONTRACT — status plans carry the site_scope text the generator would emit.
 *
 * Since 00238 every site table has a RESTRICTIVE site_scope policy generated
 * from packages/db/src/site-scope/manifest.ts. Tables created after 00238 carry
 * that policy in their own migration (00243, 00244, 00245). Hand-copying it is
 * how the two drift, so this test regenerates the text from the manifest and
 * demands the migration contain it byte for byte: the manifest is the source,
 * the migration is the artefact, and neither is a mirror of the other.
 *
 * The migration is found by name pattern, not number, so a renumber at apply
 * time does not break this test.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMigration } from '../../site-scope/generate'
import { GATED, RESOLVERS } from '../../site-scope/manifest'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')
const TABLES = ['tenants.status_plans', 'tenants.status_plan_shapes'] as const

function statusPlansMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_status_plans\.sql$/.test(f))
  expect(files, 'exactly one <number>_status_plans.sql migration').toHaveLength(1)
  return readFileSync(join(MIGRATIONS_DIR, files[0]!), 'utf8')
}

/** The generator's DROP + CREATE POLICY text for one table, through the WITH CHECK semicolon. */
function generatedPolicy(sql: string, table: string): string {
  const start = sql.indexOf(`DROP POLICY IF EXISTS site_scope ON ${table};`)
  expect(start, `generator emits no site_scope for ${table}: add it to the manifest`).toBeGreaterThan(-1)
  const withCheck = sql.indexOf('WITH CHECK (', start)
  const end = sql.indexOf(';', withCheck)
  return sql.slice(start, end + 1)
}

function generatedResolver(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.site_project_of_${name}(p_id uuid)`)
  expect(start, `generator emits no resolver ${name}: add it to the manifest`).toBeGreaterThan(-1)
  const grant = `GRANT EXECUTE ON FUNCTION public.site_project_of_${name}(uuid) TO authenticated, service_role;`
  const end = sql.indexOf(grant, start)
  return sql.slice(start, end + grant.length)
}

describe('status plans site_scope matches the generator', () => {
  const generated = generateMigration()
  const migration = statusPlansMigration()

  it('the manifest gates both tables and declares the status_plan resolver', () => {
    const gated = GATED.map((g) => g.table)
    for (const t of TABLES) expect(gated, t).toContain(t)
    expect(RESOLVERS.find((r) => r.name === 'status_plan')?.table).toBe('tenants.status_plans')
  })

  it('the migration carries the resolver text byte for byte', () => {
    expect(migration).toContain(generatedResolver(generated, 'status_plan'))
  })

  for (const t of TABLES) {
    it(`${t}: the migration carries the site_scope policy text byte for byte`, () => {
      expect(migration).toContain(generatedPolicy(generated, t))
    })
  }

  it('can fail: a table the migration does not create is not found in it', () => {
    expect(migration).not.toContain(generatedPolicy(generated, 'tenants.floor_plan_markups'))
  })
})
