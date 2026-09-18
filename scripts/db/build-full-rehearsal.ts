// Assembles scripts/db/probes/17-full-rehearsal.sql out of the individual
// probes, so the whole end-to-end rehearsal is REPRODUCIBLE instead of a
// 355 KiB artefact that goes stale the moment a probe changes.
//
// WHY IT IS NOT A CONCATENATION. The Management API returns rows from the LAST
// row-producing statement only (measured: `SELECT 1 AS a; SELECT 2 AS b;`
// returns `[{"b":2}]`). Concatenating eleven probes would discard ten of them
// SILENTLY and report the eleventh's count as the total — the one test in the
// plan structurally incapable of failing. So the output is: every fixture DO
// block, in probe order, verbatim; then exactly ONE assertion SELECT whose arms
// are every probe's arms end to end.
//
//   node --experimental-strip-types scripts/db/build-full-rehearsal.ts
//   node --experimental-strip-types scripts/db/build-full-rehearsal.ts --check
//
// --check regenerates in memory and diffs, so a probe edited without
// re-assembling is caught rather than left to drift. Run it beside the probes.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROBES = join(HERE, 'probes')
const OUT = join(PROBES, '17-full-rehearsal.sql')
const RULE = '═'
const WIDTH = 79
/** The thinner rule that labels each probe's arms inside the one statement. */
const ARM_RULE = '─'
const ARM_WIDTH = 69

/**
 * Order matters twice over.
 *
 * The two impersonating probes (05b, 16) go LAST: each clears its claim, but
 * `set_config(…, true)` is TRANSACTION-local, so every postgres block that
 * depends on the service path must run before any impersonation at all.
 *
 * 13-backfill contributes ASSERTIONS ONLY — its fixtures live in
 * 13-backfill-fixtures.sql, which is stacked ahead of the migration (a
 * probe-created fixture would otherwise be projected by the live trigger
 * instead of by the backfill).
 *
 * 14-idempotency is DELIBERATELY ABSENT. Its arms are estate-wide snapshots —
 * "nothing moved since section H ran" — which is false in a transaction where
 * ten other probes have added, closed, voided and deleted sources. Worse, it
 * inserts an `origin='split'` row chosen by `ORDER BY w.id LIMIT 1`, and uuid
 * ordering makes that arbitrary: landing on another probe's fixture turns a
 * scalar subquery into a two-row one and the run dies with 21000, reporting
 * ZERO assertions. It runs alone, 13/13.
 */
const FIXTURE_ORDER = [
  '04-rfi-mirror', '05-writeback', '06-snag-mirror', '07-inspection-mirror',
  '08-qc-mirror', '09-diary-mirror', '10-form-mirror', '11-delete-to-void',
  '05b-guard-exemption', '16-as-a-real-user',
] as const
/** 13-backfill's arms sit after 11's, before the impersonating pair's. */
const ARM_ORDER = [
  '04-rfi-mirror', '05-writeback', '06-snag-mirror', '07-inspection-mirror',
  '08-qc-mirror', '09-diary-mirror', '10-form-mirror', '11-delete-to-void',
  '13-backfill', '05b-guard-exemption', '16-as-a-real-user',
] as const

const banner = (label: string) => {
  const head = `-- ${RULE}${RULE} ${label} `
  return head + RULE.repeat(Math.max(1, WIDTH - head.length))
}
const armBanner = (label: string) => {
  const head = `-- ${ARM_RULE}${ARM_RULE} ${label} `
  return head + ARM_RULE.repeat(Math.max(1, ARM_WIDTH - head.length))
}

const read = (name: string) => readFileSync(join(PROBES, `${name}.sql`), 'utf8')

/** Everything up to and including the last `END $tag$;` is the fixtures. */
function fixturesOf(name: string): string {
  const sql = read(name)
  const lastEnd = sql.lastIndexOf('\nEND $')
  if (lastEnd === -1) throw new Error(`${name}: no fixture DO block`)
  const semi = sql.indexOf(';', lastEnd)
  const firstDo = sql.indexOf('\nDO $')
  if (firstDo === -1) throw new Error(`${name}: no DO block`)
  return sql.slice(firstDo + 1, semi + 1).trimEnd()
}

/** The single assertion statement: the last top-level `WITH `/`SELECT '`. */
function assertionOf(name: string): string {
  const sql = read(name)
  const lastEnd = sql.lastIndexOf('\nEND $')
  const after = lastEnd === -1 ? 0 : sql.indexOf('\n', sql.indexOf(';', lastEnd)) + 1
  const rest = sql.slice(after)
  const at = rest.search(/^(WITH |SELECT ')/m)
  if (at === -1) throw new Error(`${name}: no assertion statement`)
  return rest.slice(at).replace(/;\s*$/, '').trimEnd()
}

/**
 * Turn a probe's standalone assertion into arms of one shared statement: a line
 * that is exactly `UNION ALL` is dropped and the `SELECT '…'` after it is
 * prefixed with `UNION ALL ` (comments in between stay put), and for every
 * probe but the first the leading `SELECT '` is prefixed too. The result is
 * that exactly ONE line begins with `SELECT '` — the shape check is
 * `grep -c "^SELECT '"` printing 1.
 */
function toArms(assertion: string, isFirst: boolean): string {
  const out: string[] = []
  let pending = false
  for (const line of assertion.split('\n')) {
    if (line.trim() === 'UNION ALL') { pending = true; continue }
    if (pending && /^SELECT '/.test(line)) { out.push('UNION ALL ' + line); pending = false; continue }
    out.push(line)
  }
  if (pending) throw new Error('a trailing UNION ALL had no SELECT after it')
  if (!isFirst) {
    const i = out.findIndex((l) => /^SELECT '/.test(l))
    if (i === -1) throw new Error('a probe contributed no leading SELECT')
    out[i] = 'UNION ALL ' + out[i]
  }
  return out.join('\n')
}

function build(): string {
  const parts: string[] = [readFileSync(join(HERE, 'full-rehearsal-header.txt'), 'utf8').trimEnd(), '']
  for (const name of FIXTURE_ORDER) parts.push(banner(`fixtures from ${name}.sql`), fixturesOf(name), '')

  // 13-backfill's WITH clause is hoisted to the top of the single statement so
  // its CTEs are visible to every arm. `live` excludes projects named
  // `_probe_%`, which is what keeps the other probes' fixtures out of the live
  // counts — without it `total_live_items` reads forty-odd instead of 35, for a
  // reason that has nothing to do with the backfill.
  const backfill = assertionOf('13-backfill')
  const armsAt = backfill.search(/^SELECT '/m)
  if (armsAt <= 0) throw new Error('13-backfill: expected a leading WITH clause to hoist')

  parts.push(
    banner('THE ONE ASSERTION SELECT'),
    "-- Every arm of every probe above, in probe order, as one UNION ALL. Probe",
    "-- 13's CTEs are hoisted here so its arms can see them.",
    backfill.slice(0, armsAt).trimEnd(),
  )
  const arms = ARM_ORDER.map((name, i) => {
    const a = name === '13-backfill' ? backfill.slice(armsAt) : assertionOf(name)
    return `${armBanner(`${name}.sql`)}\n${toArms(a, i === 0)}`
  })
  parts.push(arms.join('\n') + ';')
  return parts.join('\n') + '\n'
}

const text = build()
const armCount = (text.match(/^(UNION ALL )?SELECT '/gm) ?? []).length
const leading = (text.match(/^SELECT '/gm) ?? []).length
if (leading !== 1) throw new Error(`shape check failed: ${leading} lines begin with SELECT ' (want 1)`)

if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') === text) { console.log(`17-full-rehearsal.sql is current — ${armCount} arms`); process.exit(0) }
  console.error('17-full-rehearsal.sql is STALE — a probe changed without re-assembling.')
  console.error('Regenerate: node --experimental-strip-types scripts/db/build-full-rehearsal.ts')
  process.exit(1)
}
writeFileSync(OUT, text)
console.log(`wrote ${OUT} — ${armCount} arms, ${(text.length / 1024).toFixed(0)} KiB`)
