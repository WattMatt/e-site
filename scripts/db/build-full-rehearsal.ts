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
  const body = rest.slice(at).replace(/;\s*$/, '').trimEnd()
  // Only 13-backfill's CTEs are HOISTED (see build()). Any other probe's own
  // WITH clause would be spliced in mid-UNION — `UNION ALL WITH live AS (…)
  // SELECT …` — which is not valid SQL, so the whole rehearsal would abort
  // with a syntax error rather than report a missing arm. Refuse it here,
  // where the probe that did it can be named.
  if (name !== '13-backfill' && /^WITH /.test(body)) {
    throw new Error(
      `${name}: its assertion statement begins with a WITH clause. Only 13-backfill's CTEs are ` +
      'hoisted to the top of the one shared statement; another probe\'s WITH would be emitted ' +
      'mid-UNION and the file would not parse. Fold the CTE into the arms that need it, or teach ' +
      'build() to hoist this one too.',
    )
  }
  return body
}

/**
 * How many assertion arms each probe contributes to the one statement.
 *
 * WHY THIS EXISTS. The shape check below (`exactly one line begins with
 * SELECT '`) proves the arms were WELDED into one statement; it says nothing
 * about how many survived. A probe that silently loses arms — an edit that
 * drops a `UNION ALL SELECT '…'` block, a `fixturesOf` boundary that swallows
 * the first arm — still produces a well-formed file, and the rehearsal then
 * reports "N/N green" against a smaller N. So the count is DECLARED here and
 * every probe is checked against its own number, by name. Change a probe's arm
 * count deliberately and you change this map in the same commit; change it by
 * accident and the generator names the probe.
 *
 * MEASURED from the probe files (whole-branch review, finding 3): 08, 09 and 10
 * each gained rule 2's arm-side row (finding 1) and 13 gained
 * floor_is_computed_per_project (c115160).
 */
const EXPECTED_ARMS: Record<(typeof ARM_ORDER)[number], number> = {
  '04-rfi-mirror': 26,
  '05-writeback': 22,
  '06-snag-mirror': 25,
  '07-inspection-mirror': 39,
  '08-qc-mirror': 36,
  '09-diary-mirror': 24,
  '10-form-mirror': 27,
  '11-delete-to-void': 15,
  '13-backfill': 31,
  '05b-guard-exemption': 9,
  '16-as-a-real-user': 16,
}
const EXPECTED_TOTAL = Object.values(EXPECTED_ARMS).reduce((a, b) => a + b, 0)

/** Arms in a chunk of the one statement: the first probe's leading `SELECT '` and every `UNION ALL SELECT '`. */
const armsIn = (text: string) => (text.match(/^(UNION ALL )?SELECT '/gm) ?? []).length

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
  const wrong: string[] = []
  const arms = ARM_ORDER.map((name, i) => {
    const a = name === '13-backfill' ? backfill.slice(armsAt) : assertionOf(name)
    const body = toArms(a, i === 0)
    const n = armsIn(body)
    if (n !== EXPECTED_ARMS[name]) wrong.push(`${name}.sql contributed ${n} arms, EXPECTED_ARMS says ${EXPECTED_ARMS[name]}`)
    return `${armBanner(`${name}.sql`)}\n${body}`
  })
  if (wrong.length > 0) {
    throw new Error(
      `arm-count check failed \u2014 ${wrong.length} probe(s) contributed a different number of assertions ` +
      `than declared:\n  ${wrong.join('\n  ')}\n` +
      'A probe that silently loses arms still assembles, and the rehearsal then reports "N/N green" ' +
      'against a smaller N. If the change is deliberate, update EXPECTED_ARMS in ' +
      'scripts/db/build-full-rehearsal.ts in the same commit.',
    )
  }
  parts.push(arms.join('\n') + ';')
  return parts.join('\n') + '\n'
}

const text = build()
const armCount = (text.match(/^(UNION ALL )?SELECT '/gm) ?? []).length
const leading = (text.match(/^SELECT '/gm) ?? []).length
if (leading !== 1) throw new Error(`shape check failed: ${leading} lines begin with SELECT ' (want 1)`)
// The per-probe check above cannot catch an arm that leaks in BETWEEN the
// chunks (a stray row in the hoisted WITH clause, say), so the total is
// asserted against the same declared map.
if (armCount !== EXPECTED_TOTAL) {
  throw new Error(`arm-count check failed: the assembled file carries ${armCount} arms, EXPECTED_ARMS sums to ${EXPECTED_TOTAL}`)
}

if (process.argv.includes('--check')) {
  if (readFileSync(OUT, 'utf8') === text) { console.log(`17-full-rehearsal.sql is current — ${armCount} arms`); process.exit(0) }
  console.error('17-full-rehearsal.sql is STALE — a probe changed without re-assembling.')
  console.error('Regenerate: node --experimental-strip-types scripts/db/build-full-rehearsal.ts')
  process.exit(1)
}
writeFileSync(OUT, text)
console.log(`wrote ${OUT} — ${armCount} arms, ${(text.length / 1024).toFixed(0)} KiB`)
