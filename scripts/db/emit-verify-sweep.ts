#!/usr/bin/env node --experimental-strip-types
/**
 * Writes an assertions file that re-checks every @verify directive of every
 * migration >= <since> (default 00185), for the dry-run harness:
 *
 *   node --experimental-strip-types scripts/db/emit-verify-sweep.ts "$TMPDIR/verify-sweep.sql" [since]
 *   scripts/db/dry-run-migration.sh <new-migration.sql> "$TMPDIR/verify-sweep.sql"
 *
 * The harness applies the new migration and the sweep in one rolled-back
 * transaction, so each earlier block is judged against the state the new
 * migration leaves behind, which is exactly what the post-push verifier will
 * see on the next deploy. Write the output OUTSIDE the migrations folder.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildVerifySweepSql } from '../../packages/shared/src/lib/migrations/verify-header.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = join(ROOT, 'apps/edge-functions/supabase/migrations')
const out = process.argv[2]
const since = process.argv[3] ?? '00185'
if (!out) {
  console.error('usage: emit-verify-sweep.ts <out.sql> [since]')
  process.exit(1)
}
if (resolve(out).startsWith(DIR)) {
  console.error('refusing to write into the migrations folder: db push would read it')
  process.exit(1)
}
const entries = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && f.slice(0, 5) >= since)
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(DIR, file), 'utf8') }))
writeFileSync(out, buildVerifySweepSql(entries))
console.log(`wrote ${out}: ${entries.length} migrations since ${since}`)
