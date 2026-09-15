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

/** `--` line comments blanked, so a key mentioned in prose never reads as a CHECK value. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/**
 * Returns the FIRST migration (sorted by filename) whose comment-stripped
 * SQL contains `needle` — i.e. the one that CREATEs the table. A later
 * `ALTER TABLE … DROP CONSTRAINT / ADD CONSTRAINT` that widens or narrows
 * the CHECK is invisible to this lookup, so such a migration MUST also update
 * this test to read the constraint from the file that now defines it.
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

function checkValues(sql: string, column: string): string[] {
  const src = stripLineComments(sql)
  // Either the inline CHECK on the column at CREATE time, or a later named
  // `ADD CONSTRAINT <table>_<column>_check CHECK (<column> IN (…))` that
  // redefined it (00199 widened product_events.event this way).
  const m =
    src.match(new RegExp(`${column}\\s+text\\s+NOT NULL[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i')) ??
    src.match(new RegExp(`ADD CONSTRAINT\\s+\\w+_${column}_check\\s+CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i'))
  if (!m) throw new Error(`Could not locate the ${column} CHECK constraint`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
}

describe('product-event registry', () => {
  it('equals public.product_events.event CHECK in both directions', () => {
    const sql = migrationContaining('ADD CONSTRAINT product_events_event_check')
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

  it('RATIO_METRIC_KEYS is exactly the set of keys whose unit is "%" — the two registries would drift silently otherwise', () => {
    const percentKeys = METRIC_KEYS.filter((k) => METRIC_UNITS[k] === '%').sort()
    expect([...RATIO_METRIC_KEYS].sort()).toEqual(percentKeys)
  })

  it('the contractor target is stated on the measured denominator of 12, not §15’s 13', () => {
    expect(METRIC_TARGET_Q1.contractor_active_frozen).toBe('6 of 12 (50%)')
  })
})
