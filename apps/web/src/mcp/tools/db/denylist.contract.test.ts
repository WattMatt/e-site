import { it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { WRITE_DENYLIST, isWriteDenied } from './denylist'

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

// Position of the last statement of a kind for schema.table (a table or a plain view), as [file index, offset], or null.
function last(kind: 'create' | 'drop', schema: string, table: string): [number, number] | null {
  const head = kind === 'create'
    ? 'create\\s+(?:or\\s+replace\\s+)?(?:table|view)\\s+(?:if\\s+not\\s+exists\\s+)?'
    : 'drop\\s+(?:table|view)\\s+(?:if\\s+exists\\s+)?(?:[\\w."]+\\s*,\\s*)*'
  const re = new RegExp(`${head}"?${schema}"?\\s*\\.\\s*"?${table}"?(?![\\w])`, 'gi')
  let found: [number, number] | null = null
  sql.forEach((text, i) => { for (const m of text.matchAll(re)) found = [i, m.index ?? 0] })
  return found
}
const after = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])

// Every plain view as it stands after the last migration: its final definition text (options + body), unless
// dropped afterwards. A MATERIALIZED view is not matched: it is never auto-updatable, so it cannot carry a write.
function views(): Map<string, string> {
  const re = /\b(create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|recursive)\s+)?view|drop\s+view\s+(?:if\s+exists\s+)?)\s*(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?([^;]*);/gi
  const out = new Map<string, string>()
  for (const text of sql) {
    for (const m of text.matchAll(re)) {
      const name = `${(m[2] ?? 'public').toLowerCase()}.${m[3].toLowerCase()}`
      if (/^drop/i.test(m[1])) out.delete(name)
      else out.set(name, m[4])
    }
  }
  return out
}

/** The denylist entries a view's definition reads from, word-matched as schema.table (schema.* matches any table). */
function deniedBases(body: string): string[] {
  return WRITE_DENYLIST.map(e => e.table).filter(t => {
    const [s, n] = t.split('.')
    const tail = n === '*' ? '"?\\w' : `"?${n}"?(?![\\w])`
    return new RegExp(`(?<![\\w.])"?${s}"?\\s*\\.\\s*${tail}`, 'i').test(body)
  })
}

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

// A plain view over one table is auto-updatable, and `authenticated` keeps the default privileges on it, so a
// write through the view lands in the base table. A view that reads a denylisted table must be denylisted itself.
it('every view over a denylisted table is denylisted too', () => {
  const all = views()
  // Not vacuous: the parser sees the plain views and skips the materialized one.
  expect([...all.keys()]).toEqual(expect.arrayContaining(['public.metric_accounts', 'public.rate_observations_active']))
  expect(all.has('marketplace.supplier_rating_summary')).toBe(false)

  const missing: string[] = []
  for (const [view, body] of all) {
    const bases = deniedBases(body)
    if (bases.length > 0 && !isWriteDenied(...(view.split('.') as [string, string]))) missing.push(`${view} (reads ${bases.join(', ')})`)
  }
  expect(missing, `add these views to WRITE_DENYLIST: ${missing.join('; ')}`).toEqual([])
})

it('the view guard finds public.metric_accounts reading public.profiles', () => {
  expect(deniedBases(views().get('public.metric_accounts') ?? '')).toEqual(['public.profiles'])
  expect(deniedBases(views().get('public.rate_observations_active') ?? '')).toEqual([])
})
