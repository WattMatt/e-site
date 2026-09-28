// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { batterySnapshot, inverterSnapshot, moduleSnapshot } from '@esite/shared/solar-cases'

/**
 * The equipment snapshot in a case config has TWO writers: the save action (moduleSnapshot /
 * inverterSnapshot / batterySnapshot in @esite/shared) and the DB trigger solar.cases_bind (00215),
 * which REBUILDS every written snapshot from solar.equipment so a PATCH cannot forge coefficients.
 * If the two shapes drift, every save produces a config the trigger rewrites into something the
 * strict CaseConfigSchema then refuses (or silently drops a field the engine reads). This pins the
 * trigger's jsonb_build_object keys, and the specs key each one copies, to the TS builders.
 */
const REPO_ROOT = resolve(__dirname, '../../../../../..')
const SQL = readFileSync(join(REPO_ROOT, 'apps/edge-functions/supabase/migrations/00215_solar_cases.sql'), 'utf8')

function sqlSnapshot(kind: 'module' | 'inverter' | 'battery'): Array<[string, string]> {
  const body = SQL.split('snapshot-rebuild:begin')[1]?.split('snapshot-rebuild:end')[0] ?? ''
  const arm = kind === 'battery'
    ? /ELSE jsonb_build_object\(([^)]*)\)/.exec(body)
    : new RegExp(`WHEN '${kind}' THEN jsonb_build_object\\(([^)]*)\\)`).exec(body)
  if (!arm) return []
  const args = arm[1]!.split(',').map((s) => s.trim())
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < args.length; i += 2) pairs.push([args[i]!.replace(/'/g, ''), args[i + 1]!])
  return pairs
}

const row = { id: '00000000-0000-4000-8000-000000000001', make: 'Acme', model: 'X', specs: {} as Record<string, unknown> }
const ts = {
  module: Object.keys(moduleSnapshot(row)),
  inverter: Object.keys(inverterSnapshot(row)),
  battery: Object.keys(batterySnapshot(row)),
}

describe('00215 cases_bind snapshot rebuild ≡ @esite/shared snapshot builders', () => {
  for (const kind of ['module', 'inverter', 'battery'] as const) {
    it(`${kind}: same keys, in the same order, each spec key copied from specs->'<same key>'`, () => {
      const pairs = sqlSnapshot(kind)
      expect(pairs.map(([k]) => k)).toEqual(ts[kind])
      expect(pairs.slice(0, 3)).toEqual([['equipmentId', 'e.id'], ['make', 'e.make'], ['model', 'e.model']])
      for (const [k, v] of pairs.slice(3)) expect(v).toBe(`e.specs->'${k}'`)
    })
  }
})
