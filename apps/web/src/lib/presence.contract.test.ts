import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// presence.ts carries the `server-only` guard (resolved to a stub under
// vitest); mocked above the import as belt-and-braces, like its sibling tests.
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: vi.fn() }) }))

import { PRESENCE_PLATFORMS } from './presence'

/**
 * Set equality in BOTH directions between the TypeScript presence vocabulary
 * and the SQL that enforces it, parsed out of the migration rather than
 * restated here — the shape of packages/shared's product-events contract test.
 *
 * A platform in code and not in the CHECK fails (touch_presence would raise
 * and the row would be rejected). A value in the CHECK and not in code fails
 * (nothing can send it, so it is dead vocabulary mistaken for a live one).
 * The three SQL spellings — both table CHECKs and the RPC guard — are each
 * asserted, so no one of them can drift from the other two either.
 */
const REPO_ROOT = resolve(__dirname, '../../../..')
const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

/** `--` line comments blanked, so a value mentioned in prose never reads as SQL. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/**
 * The FIRST migration (sorted by filename) whose comment-stripped SQL contains
 * `needle`. A later ALTER that re-declares a CHECK is invisible to this lookup
 * and MUST update this test to read from the file that now defines it.
 */
function migrationContaining(needle: string): string {
  const sources = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8')))
  const sql = sources.find((s) => s.includes(needle))
  if (!sql) throw new Error(`No migration contains ${needle}`)
  return sql
}

/** The body of one CREATE TABLE statement, so a column name shared by two tables resolves to the right one. */
function tableBody(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE ${table} (`)
  if (start < 0) throw new Error(`No CREATE TABLE ${table}`)
  const end = sql.indexOf(');', start)
  return sql.slice(start, end)
}

function checkValues(sql: string, column: string): string[] {
  const m = sql.match(new RegExp(`${column}\\s+text\\s+NOT NULL[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i'))
  if (!m) throw new Error(`Could not locate the ${column} CHECK constraint`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
}

const expected = [...PRESENCE_PLATFORMS].sort()
const sql = migrationContaining('CREATE TABLE public.user_sessions')

describe('presence vocabulary', () => {
  it('equals public.user_sessions.platform CHECK in both directions', () => {
    expect(checkValues(tableBody(sql, 'public.user_sessions'), 'platform')).toEqual(expected)
  })

  it('equals public.user_presence.platform CHECK in both directions', () => {
    expect(checkValues(tableBody(sql, 'public.user_presence'), 'platform')).toEqual(expected)
  })

  it("equals touch_presence()'s own platform guard in both directions", () => {
    const m = sql.match(/v_plat\s+NOT IN\s*\(([^)]*)\)/)
    if (!m) throw new Error('Could not locate the v_plat NOT IN guard in touch_presence')
    expect([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()).toEqual(expected)
  })
})
