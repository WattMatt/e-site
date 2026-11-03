import { it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { WRITE_DENYLIST } from './denylist'

// Walk up from this file until the migrations folder is found.
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

const dir = findMigrations()
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const sql = files.map(f => readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, ''))

// Position of the last statement of a kind for schema.table, as [file index, offset], or null.
function last(kind: 'create' | 'drop', schema: string, table: string): [number, number] | null {
  const head = kind === 'create' ? 'create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?' : 'drop\\s+table\\s+(?:if\\s+exists\\s+)?(?:[\\w."]+\\s*,\\s*)*'
  const re = new RegExp(`${head}"?${schema}"?\\s*\\.\\s*"?${table}"?(?![\\w])`, 'gi')
  let found: [number, number] | null = null
  sql.forEach((text, i) => { for (const m of text.matchAll(re)) found = [i, m.index ?? 0] })
  return found
}
const after = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])

it('reads the migrations', () => expect(files.length).toBeGreaterThan(100))

it.each(WRITE_DENYLIST.filter(e => !e.table.endsWith('.*')))('$table exists and is not dropped later', ({ table }) => {
  const [schema, name] = table.split('.')
  const created = last('create', schema, name)
  expect(created, `${table} is never created`).not.toBeNull()
  const dropped = last('drop', schema, name)
  if (dropped) expect(after(created!, dropped), `${table} is dropped after it is created`).toBe(true)
})

it('billing.* names a schema that has tables', () => {
  expect(sql.some(t => /create\s+table\s+(?:if\s+not\s+exists\s+)?"?billing"?\s*\./i.test(t))).toBe(true)
})

it('every entry has a non-empty reason and a schema.table name', () => {
  for (const e of WRITE_DENYLIST) {
    expect(e.table).toMatch(/^[a-z_]+\.([a-z_]+|\*)$/)
    expect(e.reason.trim()).not.toBe('')
  }
})
