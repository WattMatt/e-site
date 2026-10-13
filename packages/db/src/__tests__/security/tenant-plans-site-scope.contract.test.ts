/**
 * CONTRACT — the tenant plans migration carries the site-scope text the
 * generator would emit: the site_scope policy on tenants.status_plan_sheets and
 * the re-created storage site_scope_objects policy (now naming the
 * tenant-plan-files bucket). The manifest is the source, the migration is the
 * artefact; neither is a mirror of the other.
 *
 * Found by name pattern, not number, so a renumber at apply time does not
 * break this test.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMigration } from '../../site-scope/generate'
import { GATED } from '../../site-scope/manifest'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')

function tenantPlansMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_tenant_plans\.sql$/.test(f))
  expect(files, 'exactly one <number>_tenant_plans.sql migration').toHaveLength(1)
  return readFileSync(join(MIGRATIONS_DIR, files[0]!), 'utf8')
}

/** From `start` through the semicolon that ends the WITH CHECK clause after it. */
function statementFrom(sql: string, start: string): string {
  const at = sql.indexOf(start)
  expect(at, `generator emits no "${start}"`).toBeGreaterThan(-1)
  const withCheck = sql.indexOf('WITH CHECK (', at)
  const end = sql.indexOf(';', withCheck)
  return sql.slice(at, end + 1)
}

describe('tenant plans site scope matches the generator', () => {
  const generated = generateMigration()
  const migration = tenantPlansMigration()

  it('the manifest gates status_plan_sheets through the status_plan resolver', () => {
    const g = GATED.find((x) => x.table === 'tenants.status_plan_sheets')
    expect(g?.project).toEqual({ resolver: 'status_plan', column: 'status_plan_id' })
  })

  it('the migration carries the sheets site_scope policy byte for byte', () => {
    expect(migration).toContain(statementFrom(generated, 'DROP POLICY IF EXISTS site_scope ON tenants.status_plan_sheets;'))
  })

  it('the migration re-creates site_scope_objects byte for byte, with the new bucket', () => {
    const objects = statementFrom(generated, 'DROP POLICY IF EXISTS site_scope_objects ON storage.objects;')
    expect(objects).toContain("'tenant-plan-files'")
    expect(migration).toContain(objects)
  })

  it('can fail: a policy the migration does not create is not found in it', () => {
    expect(migration).not.toContain(statementFrom(generated, 'DROP POLICY IF EXISTS site_scope ON tenants.floor_plan_markups;'))
  })
})
