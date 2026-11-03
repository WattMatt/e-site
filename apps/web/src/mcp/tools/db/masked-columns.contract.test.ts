import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { readMigrations } from '@/lib/mcp-mask/mask-candidates'
import { MASK_ALLOWLIST, isAllowlisted } from '@/lib/mcp-mask/allowlist'
import { buildMasked } from '@/lib/mcp-mask/build-masked'
import { MASKED, MASKED_COLUMN_NAMES } from './masked-columns'

function findMigrations(): string {
  let dir = __dirname
  for (;;) {
    const p = join(dir, 'apps/edge-functions/supabase/migrations')
    if (existsSync(p)) return p
    const up = dirname(dir)
    if (up === dir) throw new Error('migrations folder not found')
    dir = up
  }
}
const { candidates, tables } = readMigrations(findMigrations())

// A new migration column named like money fails this until `scripts/mcp/generate-masked-columns.ts` is rerun
// (the column is masked) or MASK_ALLOWLIST names it with a reason.
it('masked-columns.ts is exactly what the migrations and the allowlist produce', () => {
  const built = buildMasked(candidates, tables)
  expect(MASKED).toEqual(built.masked)
  expect(MASKED_COLUMN_NAMES).toEqual(built.names)
})

it('every allowlist entry matches at least one candidate and carries a reason', () => {
  for (const e of MASK_ALLOWLIST) {
    expect(e.reason.trim().length, `${e.schema}.${e.table}.${e.column} has no reason`).toBeGreaterThan(5)
    expect(candidates.some(c => isAllowlisted(c, [e])), `dead allowlist entry ${e.schema}.${e.table}.${e.column}`).toBe(true)
  }
})

it('masks the commercial figures and leaves measurements alone', () => {
  expect(MASKED['projects.projects'].columns).toContain('contract_value')
  expect(MASKED['projects.project_settings'].columns).toContain('retention_pct')
  expect(MASKED['inspections.responses']).toBeUndefined()
  expect(MASKED['tariffs.charges']).toBeUndefined()
})

it('a table is keyed schema.table with sorted columns and sorted keys', () => {
  const keys = Object.keys(MASKED)
  expect(keys).toEqual([...keys].sort())
  for (const k of keys) expect(MASKED[k].columns).toEqual([...MASKED[k].columns].sort())
})
