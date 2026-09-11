import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  PRODUCT_EVENTS, METRIC_KEYS, METRIC_LABELS, METRIC_UNITS, METRIC_TARGET_Q1, RATIO_METRIC_KEYS,
} from './product-events'

/**
 * Set equality in BOTH directions between the TypeScript registry and the SQL
 * CHECK constraint, parsed out of the migration rather than restated here —
 * the shape proven by snag-photo-type.contract.test.ts.
 *
 * A key in code and not in the CHECK fails (the insert would be rejected at
 * runtime). A value in the CHECK and not in code fails (nothing can emit it,
 * so it is dead vocabulary that will be mistaken for a live one).
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')
const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

function migrationContaining(needle: string): string {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .find((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes(needle))
  if (!file) throw new Error(`No migration contains ${needle}`)
  return readFileSync(join(MIGRATIONS, file), 'utf8')
}

function checkValues(sql: string, column: string): string[] {
  const m = sql.match(new RegExp(`${column}\\s+text\\s+NOT NULL[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i'))
  if (!m) throw new Error(`Could not locate the ${column} CHECK constraint`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
}

describe('product-event registry', () => {
  it('equals public.product_events.event CHECK in both directions', () => {
    const sql = migrationContaining('CREATE TABLE public.product_events')
    expect(checkValues(sql, 'event')).toEqual([...PRODUCT_EVENTS].sort())
  })
})

describe('metric-key registry', () => {
  it('equals public.platform_metrics_weekly.metric_key CHECK in both directions', () => {
    const sql = migrationContaining('CREATE TABLE public.platform_metrics_weekly')
    expect(checkValues(sql, 'metric_key')).toEqual([...METRIC_KEYS].sort())
  })

  it('every key carries a label, a unit and a Q1 target — an unlabelled row is an unreadable dashboard', () => {
    for (const k of METRIC_KEYS) {
      expect(METRIC_LABELS[k], `no label for ${k}`).toBeTruthy()
      expect(METRIC_UNITS[k], `no unit for ${k}`).toBeTruthy()
      expect(k in METRIC_TARGET_Q1, `no Q1 target entry for ${k}`).toBe(true)
    }
  })

  it('every ratio key is a real metric key — a stale entry would render a ratio as a raw number', () => {
    for (const k of RATIO_METRIC_KEYS) {
      expect(METRIC_KEYS as readonly string[]).toContain(k)
    }
  })

  it('the contractor target is stated on the measured denominator of 12, not §15’s 13', () => {
    expect(METRIC_TARGET_Q1.contractor_active_frozen).toBe('6 of 12 (50%)')
  })
})
