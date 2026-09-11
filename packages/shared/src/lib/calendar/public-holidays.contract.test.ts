import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listHolidaysNamed } from '../jbcc/sa-public-holidays'

/**
 * Appendix A(h): projects.public_holidays is a MATERIALISATION of
 * listHolidaysNamed(), not a second source. This parses the seeded rows back
 * out of the migrations and asserts set equality, per seeded year.
 *
 * Fixture-quality check — what would this have to look like to be able to
 * fail? It reads the real SQL a human could have edited by hand, and compares
 * dates AND names, per year. Editing one row in a migration fails it naming
 * the date; adding a year to calendar_years without seeding its holidays
 * fails it naming the year.
 *
 * EVERY migration that seeds the table is read, not only the first. The
 * "five years beyond today" test below is designed to force §15 §(b2)'s
 * scheduled re-seed through a NEW migration, and a finder that stopped at the
 * first file would never read it. The union mirrors what the database does:
 * files apply in filename order, every seed INSERT ends in
 * ON CONFLICT (d) DO NOTHING, so the FIRST row seeded for a date wins.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')
const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

// Rows are parsed ONLY out of `INSERT INTO projects.public_holidays … ;`
// statements, never the whole file. The combined migration carries other
// ('YYYY-MM-DD', 'text')-shaped tuples (dated literals, comments), and a
// whole-file scan would turn one of them into a phantom holiday.
const SEED_STATEMENT = /INSERT INTO projects\.public_holidays\b[\s\S]*?;/g
const SEED_ROW = /\(\s*'(\d{4}-\d{2}-\d{2})'\s*,\s*'((?:[^']|'')*)'\s*\)/g
const YEARS_STATEMENT = /INSERT INTO projects\.calendar_years\b[\s\S]*?generate_series\(\s*(\d{4})\s*,\s*(\d{4})\s*\)/g

interface SeedRow {
  d: string
  name: string
  /** The migration that first seeded this date (the one ON CONFLICT lets win). */
  file: string
}

function seedingMigrations(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }))
    .filter(({ sql }) => sql.includes('INSERT INTO projects.public_holidays'))
}

function parseSeed(): { files: string[]; rows: SeedRow[]; registeredYears: number[] } {
  const migrations = seedingMigrations()
  if (migrations.length === 0) throw new Error('No migration seeds projects.public_holidays')

  const byDate = new Map<string, SeedRow>()
  const registered = new Set<number>()
  for (const { file, sql } of migrations) {
    for (const stmt of sql.matchAll(SEED_STATEMENT)) {
      for (const m of stmt[0].matchAll(SEED_ROW)) {
        if (byDate.has(m[1])) continue // ON CONFLICT (d) DO NOTHING — first wins
        byDate.set(m[1], { d: m[1], name: m[2].replace(/''/g, "'"), file })
      }
    }
    for (const m of sql.matchAll(YEARS_STATEMENT)) {
      for (let y = Number(m[1]); y <= Number(m[2]); y++) registered.add(y)
    }
  }
  return {
    files: migrations.map((m) => m.file),
    rows: [...byDate.values()],
    registeredYears: [...registered].sort((a, b) => a - b),
  }
}

describe('projects.public_holidays is a materialisation of listHolidaysNamed', () => {
  const { files, rows, registeredYears } = parseSeed()
  const label = files.join(' + ')

  const years = [...new Set(rows.map((r) => Number(r.d.slice(0, 4))))].sort((a, b) => a - b)

  it(`${label} seeds at least ten years — the horizon is what stops working_days_between raising in production`, () => {
    expect(years.length).toBeGreaterThanOrEqual(10)
  })

  it(`${label} seeds at least five years beyond today`, () => {
    expect(Math.max(...years)).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 5)
  })

  for (const y of years) {
    it(`${y} matches listHolidaysNamed(${y}) exactly, dates and names`, () => {
      const expected = listHolidaysNamed(y)
        .map((h) => `${h.date.toISOString().slice(0, 10)}|${h.name}`)
        .sort()
      const actual = rows
        .filter((r) => r.d.startsWith(String(y)))
        .map((r) => `${r.d}|${r.name}`)
        .sort()
      expect(actual).toEqual(expected)
    })
  }

  it('every seeded year is registered in calendar_years, and no registered year lacks a seed', () => {
    expect(registeredYears.length, 'calendar_years is not seeded by generate_series in any seeding migration').toBeGreaterThan(0)
    expect(registeredYears).toEqual(years)
  })
})
