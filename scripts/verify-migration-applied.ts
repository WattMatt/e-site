#!/usr/bin/env node --experimental-strip-types
/**
 * Verify that migrations carrying a `-- @verify:` block ACTUALLY APPLIED.
 *
 *   node --experimental-strip-types scripts/verify-migration-applied.ts
 *   node --experimental-strip-types scripts/verify-migration-applied.ts --since 00184
 *   node --experimental-strip-types scripts/verify-migration-applied.ts --file 00186_revoke_anon_execute_security_definer.sql
 *   node --experimental-strip-types scripts/verify-migration-applied.ts --dir /tmp/verify-proof
 *
 * --dir points the scan at a directory other than the real migrations folder.
 * It exists so the failing-fixture proof never writes a stray .sql into the
 * directory `supabase db push` reads: on a shared checkout an interrupted run
 * would leave a file whose number can collide with a real migration.
 *
 * Auth: SUPABASE_ACCESS_TOKEN (set as a repo secret and used by
 * deploy-migrations.yml), else the macOS keychain entry "Supabase CLI",
 * handling the go-keyring-base64 prefix — the same resolution
 * scripts/db/mgmt-api.sh uses, so local and CI behave identically. The token is
 * read into an Authorization header and is never logged.
 *
 * READ-ONLY BY CONSTRUCTION. Every predicate is sent wrapped in
 * `BEGIN READ ONLY; … COMMIT;`, so this is safe to point at production: Postgres
 * refuses any write inside such a transaction (SQLSTATE 25006). That matters
 * because a `sql:` directive's payload is interpolated verbatim out of a
 * migration file — the wrapper is what makes "it only ever SELECTs" a property
 * of the tool rather than a property of the files it happens to read today.
 *
 * ONE REQUEST PER MIGRATION, falling back to one per directive. Each
 * migration's directives go out as a single SELECT returning one row per
 * directive (runDirectivesBatched). If that statement RAISES —
 * has_table_privilege / has_function_privilege raise on an object that does not
 * exist, which is exactly the situation this tool exists for — it re-runs one
 * predicate per transaction, so the raise is pinned to its directive instead of
 * aborting every answer behind "current transaction is aborted".
 *
 * RETRIES. 429, 5xx and network failures are retried with backoff + jitter,
 * honouring Retry-After (mgmt-query.ts). Run 37289583207 reported 543 ✗ lines
 * that were all `Management API 429` while two other deploys verified at once;
 * none was a false predicate. If the API still refuses after the retry budget,
 * the run stops and reports an INFRASTRUCTURE error — the predicates were not
 * evaluated, so it must read neither as ✓ nor as ✗.
 *
 * Exit 0 = every directive returned true. Exit 1 = a predicate failed (or a
 * block was malformed, or nothing was checked). Exit 2 = the Management API
 * could not be asked and no predicate had failed before it; re-run the workflow.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  parseVerifyBlock,
  runDirectivesBatched,
} from '../packages/shared/src/lib/migrations/verify-header.ts'
import {
  createReadOnlyMgmtQuery,
  isInfrastructureError,
} from '../packages/shared/src/lib/migrations/mgmt-query.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'

function pat(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
    encoding: 'utf8',
  }).trim()
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim()
    : raw
}

// The READ ONLY wrapper, the retry policy and the infrastructure/predicate
// split all live in createReadOnlyMgmtQuery, so no call site can route around
// them. Retries are logged so a slow run explains itself in the CI log.
const query = createReadOnlyMgmtQuery({
  projectRef: PROJECT_REF,
  token: pat,
  fetch: globalThis.fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  onRetry: ({ attempt, status, delayMs }) =>
    console.warn(`  … Management API ${status ?? 'unreachable'}; retry ${attempt} in ${(delayMs / 1000).toFixed(1)}s`),
})

const argv = process.argv.slice(2)
const argOf = (flag: string) => {
  const i = argv.indexOf(flag)
  return i === -1 ? null : argv[i + 1]
}
const since = argOf('--since')
const onlyFile = argOf('--file')
const dir = argOf('--dir')
const MIGRATIONS = dir ? resolve(dir) : join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => (onlyFile ? basename(f) === basename(onlyFile) : true))
  .filter((f) => (since ? f.slice(0, 5) > since : true))
  .sort()

let failed = 0
let checked = 0
let current = '(the ledger read)'

try {
  const ledger = await query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version',
  )
  const applied = new Set(ledger.map((r) => String(r.version)))

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    let directives
    try {
      directives = parseVerifyBlock(sql)
    } catch (e) {
      // A malformed block is a FAILURE, not a skip. A block nobody can parse
      // claims exactly as much as no block at all, and must not pass CI.
      console.error(`✗ ${file}: malformed @verify block — ${e instanceof Error ? e.message : e}`)
      failed += 1
      continue
    }
    if (directives === null) continue // pre-programme migration; no block, nothing claimed

    checked += 1
    current = file
    const version = file.slice(0, 5)

    // THE check. `supabase db push` keys on the version PREFIX: a number already
    // in the ledger makes it print "Remote database is up to date", exit 0 and
    // skip the file. A green workflow proves nothing; this line does.
    if (!applied.has(version)) {
      console.error(
        `✗ ${file}: version ${version} is NOT in supabase_migrations.schema_migrations — db push skipped it`,
      )
      failed += 1
      continue
    }

    const { passed, failures, skipped } = await runDirectivesBatched(directives, query)
    if (failures.length === 0) {
      const note = skipped.length ? ` (${skipped.length} behaviour: line(s) for a human)` : ''
      console.log(`✓ ${file} — ${passed} directive(s) verified${note}`)
    } else {
      for (const f of failures) {
        console.error(`✗ ${file}:${f.directive.line}  ${f.directive.raw.trim()}\n    ${f.reason}`)
      }
      failed += failures.length
    }
  }
} catch (e) {
  if (!isInfrastructureError(e)) throw e
  // Not a ✗: nothing was evaluated from here on. Reporting it as N predicate
  // failures is what made run 37289583207 look like 543 broken migrations.
  console.error(
    `\n⚠ INFRASTRUCTURE ERROR while verifying ${current} — the Management API could not be asked.\n` +
      `  ${e.message}\n` +
      `  This is NOT a predicate failure: the remaining directives were never evaluated.\n` +
      `  So far: ${Math.max(0, checked - 1)} migration(s) fully checked, ${failed} predicate failure(s).\n` +
      (e.status === 401 || e.status === 403
        ? `  Check SUPABASE_ACCESS_TOKEN (repo secret) / the "Supabase CLI" keychain entry.`
        : `  Re-run the workflow (or: node --experimental-strip-types scripts/verify-migration-applied.ts) once the API recovers.`),
  )
  // A predicate that already failed is still a real failure: it outranks the outage.
  process.exit(failed > 0 ? 1 : 2)
}

// Order matters: report the failures that happened before the "nothing was
// checked" guard, or a run whose only file carried a malformed block reports
// "no migration carried a @verify block" — true, but not the useful half.
if (failed > 0) {
  console.error(`\n✗ ${failed} verification failure(s) across ${checked} migration(s)`)
  process.exit(1)
}
// A run that verified nothing must not print green. That is the same failure
// mode as a green `db push` that applied nothing.
if (checked === 0) {
  console.error('✗ no migration carried a @verify block — refusing to report green on nothing')
  process.exit(1)
}
console.log(`\n✓ ${checked} migration(s) verified against ${PROJECT_REF}`)
