// packages/db/src/site-scope/generate.test.ts
import { describe, it, expect } from 'vitest'
import { generateMigration, projectExpr } from './generate'
import { RESOLVERS, GATED } from './manifest'

describe('site_scope generator', () => {
  const sql = generateMigration()

  it('gives every gated table exactly one RESTRICTIVE FOR ALL site_scope policy using the access function', () => {
    for (const g of GATED) {
      const create = `CREATE POLICY site_scope ON ${g.table} AS RESTRICTIVE FOR ALL`
      expect(sql.split(create).length - 1, g.table).toBe(1)
    }
    expect((sql.match(/USING \(public\.user_has_project_access\(/g) ?? []).length).toBeGreaterThanOrEqual(GATED.length)
  })

  it('creates every resolver before any policy uses it, revoked from anon', () => {
    for (const r of RESOLVERS) {
      const fn = `public.site_project_of_${r.name}(`
      const def = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}`)
      const use = sql.indexOf(`${fn}`, def + 10)
      expect(def, r.name).toBeGreaterThan(-1)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.site_project_of_${r.name}(uuid) FROM PUBLIC, anon;`)
      if (use > -1) expect(use).toBeGreaterThan(def)
    }
  })

  it('every child references a resolver that exists', () => {
    const names = new Set(RESOLVERS.map((r) => r.name))
    for (const g of GATED) if ('resolver' in g.project) expect(names.has(g.project.resolver), g.table).toBe(true)
  })

  it('no table is gated twice', () => {
    const seen = GATED.map((g) => g.table)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('projectExpr renders direct and child shapes', () => {
    expect(projectExpr({ column: 'project_id' })).toBe('project_id')
    expect(projectExpr({ resolver: 'rfi', column: 'rfi_id' })).toBe('public.site_project_of_rfi(rfi_id)')
  })

  it('emits a parseable @verify block naming every gated table', () => {
    const block = sql.slice(sql.indexOf('-- @verify:begin'), sql.indexOf('-- @verify:end'))
    for (const g of GATED) expect(block).toContain(`-- policy: site_scope ON ${g.table} RESTRICTIVE`)
    expect(block).not.toMatch(/sql:[^\n]*—/) // no em dash in a sql payload (#194)
  })
})
