import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import v11 from '../../../../../packages/shared/src/site-forms/templates/termination-and-making-safe-v1.1.json'
import v10 from '../../../../../packages/shared/src/site-forms/templates/termination-and-making-safe.json'

/**
 * Contract for migration 00183, which seeds template v1.1 and retires v1.0.
 *
 * The sibling test for 00180 guards the v1.0 seed. This guards three things
 * that only matter for a VERSION BUMP:
 *
 *  - the seeded JSON is byte-identical to its source file (same drift guard);
 *  - the migration deactivates exactly v1.0 and nothing else — a stray
 *    predicate here would either leave two active templates in the picker or
 *    deactivate a future version;
 *  - v1.1 did not rename or drop any identifier v1.0 had. The prefill map, the
 *    six submit gates and the signature-block map all key on field ids, and a
 *    rename would break them silently: prefill would write to a field that no
 *    longer exists, and a gate would read undefined and pass.
 */

function findRepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'apps/edge-functions/supabase/migrations'))) return dir
    dir = dirname(dir)
  }
  throw new Error('Could not locate the repo root from ' + process.cwd())
}

const REPO_ROOT = findRepoRoot()
const MIGRATION = join(
  REPO_ROOT,
  'apps/edge-functions/supabase/migrations/00183_site_forms_template_v1_1.sql',
)
const TEMPLATE_JSON = resolve(
  REPO_ROOT,
  'packages/shared/src/site-forms/templates/termination-and-making-safe-v1.1.json',
)

const SEED_DELIMITED = /\$seed\$([\s\S]*?)\$seed\$::jsonb/

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8')
}

function seedBlock(sql: string): string {
  // Anchored on the ::jsonb cast, and the delimiter-count assertion below is
  // what stops a $seed$ mentioned in a comment from swallowing the payload —
  // the failure mode the 00180 author hit first time.
  const m = sql.match(SEED_DELIMITED)
  expect(m, 'migration must wrap the JSON in a $seed$…$seed$::jsonb block').toBeTruthy()
  return m![1]
}

/** Every id at every depth, so a rename anywhere is caught. */
function identifiers(t: unknown): {
  sections: Set<string>
  fields: Set<string>
  options: Set<string>
} {
  const sections = new Set<string>()
  const fields = new Set<string>()
  const options = new Set<string>()
  for (const s of (t as { sections: any[] }).sections) {
    sections.add(s.section_id)
    for (const f of s.fields ?? []) {
      fields.add(f.field_id)
      for (const o of f.options ?? []) options.add(`${f.field_id}:${o}`)
      for (const sub of f.fields ?? []) {
        fields.add(`${f.field_id}[].${sub.field_id}`)
        for (const o of sub.options ?? []) options.add(`${f.field_id}[].${sub.field_id}:${o}`)
      }
    }
  }
  return { sections, fields, options }
}

describe('00183 v1.1 seed contract', () => {
  it('seeds the JSON file byte-for-byte', () => {
    const seeded = seedBlock(migrationSql())
    expect(seeded).toBe(readFileSync(TEMPLATE_JSON, 'utf8').trim())
  })

  it('the seeded document parses as v1.1', () => {
    expect(JSON.parse(seedBlock(migrationSql()))).toEqual(v11)
    expect((v11 as { version: string }).version).toBe('1.1')
  })

  it('contains exactly one delimiter pair, so no comment can swallow the payload', () => {
    expect((migrationSql().match(/\$seed\$/g) ?? []).length).toBe(2)
  })

  it('seeds a system template that is active', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/INSERT INTO field\.form_templates/)
    expect(sql).toMatch(/NULL,\s*\n\s*'termination-and-making-safe',\s*\n\s*'1\.1'/)
  })

  it('retires exactly v1.0 — not the row it just inserted, not a future version', () => {
    const sql = migrationSql()
    const update = sql.slice(sql.indexOf('UPDATE field.form_templates'))
    expect(update).toMatch(/SET is_active = false/)
    expect(update).toMatch(/version = '1\.0'/)
    expect(update).toMatch(/template_key = 'termination-and-making-safe'/)
    expect(update).toMatch(/organisation_id IS NULL/)
    // Guards the accident that would deactivate every version including v1.1.
    expect(update).not.toMatch(/version <> '1\.1'/)
    expect(update).not.toMatch(/version IS NOT NULL/)
  })

  it('is safe to re-apply and reloads the schema cache', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/)
    expect(sql.indexOf("NOTIFY pgrst")).toBeGreaterThan(sql.indexOf('COMMIT;'))
  })
})

describe('v1.1 keeps every identifier v1.0 had', () => {
  const a = identifiers(v10)
  const b = identifiers(v11)

  it('no section was renamed or dropped', () => {
    expect([...a.sections].filter((x) => !b.sections.has(x))).toEqual([])
  })

  it('no field id was renamed or dropped, at any depth', () => {
    // The prefill map writes by field id; a gate reads by field id. A rename
    // makes prefill write nowhere and a gate read undefined — both silent.
    expect([...a.fields].filter((x) => !b.fields.has(x))).toEqual([])
  })

  it('no dropdown option token was renamed or dropped', () => {
    // Gates compare against literal tokens (e.g. 'energised_returned_to_service',
    // 'C1', 'electrical_tester_single_phase'). A retokenised option silently
    // stops matching.
    expect([...a.options].filter((x) => !b.options.has(x))).toEqual([])
  })

  it('adds only the two intended new fields', () => {
    expect([...b.fields].filter((x) => !a.fields.has(x)).sort()).toEqual([
      'hazard_sweep_completed',
      'work_type',
    ])
  })
})
