import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseVerifyBlock } from '@esite/shared'

/**
 * §12 §(h) test 5 — migration hygiene.
 *
 * Every migration in this programme carries a well-formed `-- @verify:` block,
 * and every TABLE, VIEW and FUNCTION it creates appears in that block.
 *
 * ⚠ Scope, stated exactly rather than generously: this checks tables, views and
 * functions ONLY. Policies, constraints, indexes, triggers and cron jobs are
 * declared in the blocks by convention and reviewed by hand; nothing here
 * enforces them. Saying "every object it creates" when the code checks three
 * kinds is the decorative-check pattern in prose form.
 *
 * §12 §(h) test 8 — the A(f) registry diff — does NOT exist yet and is not
 * built here. Registering a new object in Appendix A(f) is a review discipline
 * until someone owns it.
 *
 * Migrations that predate the programme carry no block and are not in scope —
 * the floor below is what draws that line, and it sits at ITEM 0's migration
 * so item 0 is covered too.
 */
const REPO_ROOT = resolve(__dirname, '../../../..')
const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

/** Everything at or after this version belongs to the v2 programme. Item 0's migration. */
const PROGRAMME_FLOOR = '00185'

function programmeMigrations(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && f.slice(0, 5) >= PROGRAMME_FLOOR)
    .sort()
}

/** Objects the migration CREATEs, read out of the SQL itself. */
function createdObjects(sql: string) {
  const strip = sql.replace(/^\s*--.*$/gm, '')
  const grab = (re: RegExp) => [...strip.matchAll(re)].map((m) => m[1].toLowerCase())
  return {
    tables: grab(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+\.[a-z0-9_]+)/gi),
    views: grab(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([a-z0-9_]+\.[a-z0-9_]+)/gi),
    functions: grab(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z0-9_]+\.[a-z0-9_]+)/gi),
  }
}

describe('programme migrations carry a complete @verify block', () => {
  const files = programmeMigrations()

  it('there is at least one programme migration to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} declares every table, view and function it creates`, () => {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
      const directives = parseVerifyBlock(sql)
      expect(directives, `${file} carries no -- @verify: block`).not.toBeNull()

      const declared = (kind: string) =>
        new Set(
          directives!
            .filter((d) => d.kind === kind)
            .map((d) =>
              `${(d as { schema: string }).schema}.${(d as { name: string }).name}`.toLowerCase(),
            ),
        )
      const declaredTables = declared('table')
      const declaredViews = declared('view')
      const declaredFns = declared('function')

      const made = createdObjects(sql)
      for (const t of new Set(made.tables)) {
        expect(
          declaredTables.has(t),
          `${file} creates ${t} but the @verify block does not declare it`,
        ).toBe(true)
      }
      for (const v of new Set(made.views)) {
        expect(
          declaredViews.has(v),
          `${file} creates view ${v} but the @verify block does not declare it`,
        ).toBe(true)
      }
      for (const f of new Set(made.functions)) {
        expect(
          declaredFns.has(f),
          `${file} creates function ${f} but the @verify block does not declare it`,
        ).toBe(true)
      }
    })
  }
})
