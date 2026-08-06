import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Contract test: every `photo_type` literal in application code must be a member
 * of the field.snag_photos CHECK constraint.
 *
 * This exists because of a real production outage. `apps/mobile/app/snags/
 * create.tsx` wrote `photo_type: 'defect'` — a value the constraint has never
 * permitted — so every mobile snag photo insert failed AFTER its storage upload
 * had succeeded. Result: zero rows in field.snag_photos across the entire
 * production database, orphaned objects in the bucket, and (because sign-off
 * requires a 'closeout' photo) not one snag ever signed off.
 *
 * A unit test on the calling code would not have caught it — the value only
 * fails at the database. So this test reads the CHECK set from the migration
 * itself and asserts the source literals against it.
 */

// apps/web/src/lib → repo root
const REPO_ROOT = resolve(__dirname, '../../../..')
const MIGRATION = join(
  REPO_ROOT,
  'apps/edge-functions/supabase/migrations/00004_field_schema.sql',
)

const SCAN_DIRS = [
  'apps/web/src',
  'apps/mobile/app',
  'apps/mobile/src',
  'packages/shared/src',
]

const CODE_EXT = /\.(ts|tsx)$/
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|build|\.expo)(\/|$)/

/** Allowed values, parsed out of the migration rather than hardcoded here. */
function allowedPhotoTypes(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8')
  const m = sql.match(/photo_type[\s\S]{0,120}?CHECK\s*\(\s*photo_type\s+IN\s*\(([^)]*)\)/i)
  if (!m) throw new Error('Could not locate the photo_type CHECK constraint in 00004_field_schema.sql')
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (SKIP_DIR.test(full)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.test(full)) out.push(full)
  }
}

/**
 * Collect every quoted photo_type literal, in either of the two shapes the
 * codebase uses:
 *   photo_type: 'evidence'          (insert payloads / object literals)
 *   .eq('photo_type', 'closeout')   (query filters)
 *   p.photo_type === 'closeout'     (comparisons)
 */
function collectLiterals(): Array<{ file: string; value: string; line: number }> {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d), files)

  const patterns = [
    /photo_type\s*:\s*'([^']+)'/g,
    /'photo_type'\s*,\s*'([^']+)'/g,
    /photo_type\s*[=!]==?\s*'([^']+)'/g,
  ]

  const found: Array<{ file: string; value: string; line: number }> = []
  for (const file of files) {
    // The contract test itself and the migration-parsing fixtures are exempt.
    if (file.endsWith('snag-photo-type.contract.test.ts')) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const re of patterns) {
        re.lastIndex = 0
        for (const m of line.matchAll(re)) {
          found.push({ file: file.slice(REPO_ROOT.length + 1), value: m[1], line: i + 1 })
        }
      }
    })
  }
  return found
}

describe('field.snag_photos photo_type contract', () => {
  const allowed = allowedPhotoTypes()

  it('parses the CHECK set from the migration', () => {
    expect(allowed).toEqual(expect.arrayContaining(['evidence', 'closeout', 'markup']))
  })

  it('finds photo_type literals to check (the scan is actually working)', () => {
    const found = collectLiterals()
    expect(found.length).toBeGreaterThan(0)
  })

  it('every photo_type literal in app code is permitted by the constraint', () => {
    const found = collectLiterals()
    const violations = found.filter((f) => !allowed.includes(f.value))

    expect(
      violations.map((v) => `${v.file}:${v.line} → '${v.value}'`),
      `photo_type values not in the DB CHECK set [${allowed.join(', ')}]. ` +
        'These inserts WILL fail at the database (this is exactly how the ' +
        "'defect' outage shipped).",
    ).toEqual([])
  })

  it('a closeout photo can actually be written by the app (sign-off depends on it)', () => {
    // Regression guard for RC-2: signOffSnagAction and closeSnagOnVisitAction
    // both hard-require a 'closeout' photo. If no code path ever WRITES one,
    // snags become impossible to sign off — which is what shipped.
    const writers = collectLiterals().filter(
      (f) => f.value === 'closeout' && /photo_type\s*:/.test(readFileSync(join(REPO_ROOT, f.file), 'utf8').split('\n')[f.line - 1]),
    )
    expect(
      writers.length,
      "No code path writes photo_type: 'closeout'. Sign-off requires one, so " +
        'every snag would be permanently un-closable.',
    ).toBeGreaterThan(0)
  })
})
