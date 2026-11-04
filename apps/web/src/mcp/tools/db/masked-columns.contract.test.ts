import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { readMigrations, allNumericColumns, MASK_NAME } from '@/lib/mcp-mask/mask-candidates'
import { MASK_ALLOWLIST, MASK_EXTRA, isAllowlisted } from '@/lib/mcp-mask/allowlist'
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
const migrations = findMigrations()
const { candidates, tables } = readMigrations(migrations)

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

it('every extra names a real numeric column the name pattern does not already catch', () => {
  const numeric = allNumericColumns(migrations)
  for (const e of MASK_EXTRA) {
    const name = `${e.schema}.${e.table}.${e.column}`
    expect(e.reason.trim().length, `${name} has no reason`).toBeGreaterThan(5)
    expect(numeric.some(c => c.schema === e.schema && c.table === e.table && c.column === e.column), `dead extra ${name}`).toBe(true)
    expect(MASK_NAME.test(e.column), `${name} is already matched by MASK_NAME`).toBe(false)
    expect(MASKED[`${e.schema}.${e.table}`]?.columns, name).toContain(e.column)
  }
})

// The review's findings: money in columns the original name list did not match.
it.each([
  ['projects.valuations', ['gross_to_date', 'net_to_date', 'previous_net', 'due_ex_vat', 'due_incl_vat']],
  ['projects.variation_orders', ['net_change']],
  ['projects.tenders', ['stated_subtotal', 'stated_vat', 'stated_total']],
  ['marketplace.commission_records', ['commission_kobo', 'supplier_kobo']],
  ['suppliers.organisation_suppliers', ['credit_limit']],
  ['cable_schedule.cost_lines', ['contingency_pct']],
  ['gcr.settings', ['maintenance_contingency_percent']],
  ['marketplace.paystack_subaccounts', ['percentage_charge']],
  ['solar.bill_checks', ['difference_pct']],
])('%s masks its money columns', (table, columns) => {
  expect(MASKED[table]?.columns).toEqual(expect.arrayContaining(columns))
})

it('the project of a row is found by project_id, and by id on projects.projects', () => {
  expect(MASKED['projects.projects'].projectKey).toBe('id')
  expect(MASKED['projects.tenders'].projectKey).toBe('project_id')
  expect(MASKED['projects.boq_items'].projectKey).toBeNull()
})

it('masks the commercial figures and leaves measurements alone', () => {
  expect(MASKED['projects.projects'].columns).toContain('contract_value')
  expect(MASKED['projects.project_settings'].columns).toContain('retention_pct')
  expect(MASKED['inspections.responses']).toBeUndefined()
  expect(MASKED['tariffs.charge']).toBeUndefined()
  expect(MASKED['solar.meter_readings']).toBeUndefined()
})

it('a table is keyed schema.table with sorted columns and sorted keys', () => {
  const keys = Object.keys(MASKED)
  expect(keys).toEqual([...keys].sort())
  for (const k of keys) expect(MASKED[k].columns).toEqual([...MASKED[k].columns].sort())
})
