#!/usr/bin/env node --experimental-strip-types
/**
 * rehearse-sql.ts — run SQL against production inside a transaction that is
 * ALWAYS rolled back, and print the assertion rows.
 *
 * Usage:
 *   pnpm tsx scripts/db/rehearse-sql.ts <probe.sql> [--with <a.sql>] [--with <b.sql>]…
 *   node --experimental-strip-types scripts/db/rehearse-sql.ts <probe.sql> [--with …]
 *
 * ONE request per rehearsal. The harness concatenates
 *
 *   BEGIN;  +  the RFI-number sequence capture  +  every --with file, in the
 *   order given  +  the probe  +  the sequence restore  +  ROLLBACK;
 *
 * and POSTs it to the Management API's /database/query endpoint as a single
 * query, so everything the --with files and the probe do happens in one
 * transaction that is rolled back at the end. --with is REPEATABLE: it exists so
 * a probe can assert against objects that do not exist on production yet — the
 * migration under development (00202) and any future dependency — stacked ahead
 * of the probe. Do NOT stack a migration that is already applied (00194, 00195,
 * 00196 are live on cbskbnvvgcybmfikxgky): its CREATE TABLEs fail on the
 * existing objects and abort the whole rehearsal. A --with file must not carry
 * its own transaction wrapper either: a file with `BEGIN;` … `COMMIT;` around
 * its body (29 of the older migrations do) is refused by the interlock below —
 * correctly, since that COMMIT would end the rehearsal's transaction. 00202
 * must not wrap itself; the harness supplies BEGIN and ROLLBACK.
 *
 * SAFETY INTERLOCK — this harness must never be the thing that commits. Before
 * the token is read and before any request is made, the concatenated input is
 * scanned ONCE, left to right, the way PostgreSQL's own lexer reads it: string
 * literals, quoted identifiers, dollar-quoted bodies and comments (`--` line
 * comments and nested block comments) are blanked to spaces, and what remains
 * — the tokens that could actually execute — is refused if it contains:
 *   - COMMIT, case-insensitively. The word is allowed inside a comment, a
 *     string literal or a dollar-quoted body: none of those can end the
 *     transaction (a COMMIT inside a DO or function body raises 2D000 "invalid
 *     transaction termination" inside an explicit transaction block, which
 *     aborts and rolls back). The temp-table clause
 *     `ON COMMIT { DROP | DELETE ROWS | PRESERVE ROWS }`, which the probe
 *     contract below requires, is allowed too. It is one lexer pass and not
 *     "strip comments, then blank strings" or the reverse, because each of
 *     those orderings has a hole the other closes: `SELECT '--'; COMMIT;`
 *     fools comment-first stripping (the quote hides the COMMIT inside a
 *     phantom comment) and `-- don't` followed by `SELECT 'x'; COMMIT;` fools
 *     string-first blanking (the apostrophe in the comment opens a phantom
 *     string that swallows the COMMIT);
 *   - a top-level END statement: PostgreSQL treats a bare `END;` as a synonym
 *     for COMMIT. This also refuses the SQL-standard function body form
 *     `CREATE FUNCTION … BEGIN ATOMIC … END;`, whose END is a top-level token
 *     — dollar-quote the body instead; no bypass is provided;
 *   - PREPARE TRANSACTION, the other way a transaction's writes can outlive the
 *     trailing ROLLBACK.
 *
 * PROBE FILE CONTRACT (scripts/db/probes/*.sql). Every probe file is:
 *   1. zero or more `DO $…$ … END $…$;` blocks that build fixtures, perform
 *      mutations, and record observations into `TEMP TABLE … ON COMMIT DROP`;
 *      then
 *   2. EXACTLY ONE row-producing statement — a `SELECT … UNION ALL …` with the
 *      columns `probe text, ok boolean, detail text` — and it is the LAST
 *      statement in the file;
 *   3. if it impersonates (`set_config('request.jwt.claims', …, true)` +
 *      `SET LOCAL ROLE authenticated`), it ends the impersonating block with
 *      `EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true);`
 *      and carries an assertion that `auth.uid() IS NULL` afterwards.
 *      `set_config(…, true)` is TRANSACTION-local, not block-local: after
 *      `RESET ROLE`, `auth.uid()` still returns the last impersonated user,
 *      which flips §5's `opened_at` stamp, `resolve_work_item_assignee`'s caller
 *      guard and the transition guard's service-path exemption for every later
 *      `postgres` block in the same transaction — the assertion SELECT included.
 *      Seed everything a `postgres` block needs BEFORE the first impersonation.
 *      Clearing the claim to `''` works because production's `auth.uid()`
 *      reads the legacy `request.jwt.claim.sub` first, then
 *      `request.jwt.claims::jsonb ->> 'sub'`; both arms read NULL on `''`.
 * The harness enforces rule 2's observable consequence (see below); rules 1 and
 * 3 are the probe author's, checked in review.
 *
 * RFI-NUMBER SEQUENCE GUARD. `projects.rfis.rfi_number` is
 * `INTEGER GENERATED ALWAYS AS IDENTITY` (00002:83) and sequences are NOT
 * transactional: every fixture RFI a probe inserts permanently consumes a
 * number that the trailing ROLLBACK does not return. Measured drift from the
 * item-2/item-3 rehearsals: `last_value` 736 against `max(rfi_number)` 16 (15
 * live RFIs) on 2026-09-15 — the next RFI a human raises would display 737, and
 * a single 50,000-row scale rehearsal would make it five digits. So the harness
 * brackets every rehearsal:
 *   - right after BEGIN, `_rehearse_seq_guard` captures the sequence's
 *     (last_value, is_called) AND `max(rfi_number)` as they are BEFORE any
 *     --with file or probe runs;
 *   - after the probe and before ROLLBACK, a DO block setval()s the sequence
 *     back to GREATEST(captured last_value, captured max(rfi_number)). setval
 *     is non-transactional, so the restore survives the ROLLBACK while every
 *     fixture row vanishes with it.
 * Both operands are read at BEGIN, deliberately: reading `max(rfi_number)` in
 * the restore block instead would read the probe's OWN uncommitted fixture rows
 * (a 50,000-row scale probe would "restore" the sequence to 50,763 — the exact
 * drift the guard exists to prevent). GREATEST is the floor against a human
 * raising an RFI just before the rehearsal started.
 *
 * WHAT THE GUARD IS AND IS NOT SAFE AGAINST, precisely (`rfi_number` carries no
 * unique constraint, measured, so nothing here can ERROR — the risk is a silent
 * duplicate number):
 *   - rehearsal against rehearsal is SAFE. Every capture is >= the committed
 *     high-water mark at its own BEGIN, so no restore can lower the sequence
 *     below that mark. Concurrent captures do not agree (measured: one session
 *     read 771 while another's baseline was 763) and the last writer wins, so
 *     the sequence may ratchet UP — a harmless leak, never a re-use.
 *   - an RFI COMMITTED DURING the window is the one case the guard cannot see.
 *     Its number exceeds the captured last_value, the restore lowers past it,
 *     and the next RFI re-uses it silently. Unfixable inside the transaction,
 *     so: rehearse outside SA working hours.
 * A DO block produces no result set, so the probe's assertion SELECT is still
 * the LAST one the Management API sees. The restore runs only when the
 * transaction is still alive: a probe that ABORTS (a RAISE, a failed --with
 * file) rolls back without it and leaks its consumed numbers. That is the
 * COMMON path while a probe is being written — measured this session, an
 * aborted probe left the sequence at 771 against a 763 baseline. Restore by
 * hand, outside any rehearsal transaction, where max() sees only committed rows
 * and is therefore exact:
 *   source scripts/db/mgmt-api.sh
 *   mgmt_query "SELECT setval('projects.rfis_rfi_number_seq', (SELECT max(rfi_number) FROM projects.rfis), true)"
 * (the same statement Task 20 runs once, pre-apply). `is_called` is captured
 * for symmetry but deliberately unused: the forced `true` is correct for any
 * sequence that has ever issued a value, and this one has issued 763.
 *
 * WHY THE HARNESS FAILS ON ZERO ROWS. The Management API returns rows from the
 * LAST row-producing statement only (measured: `SELECT 1 AS a; SELECT 2 AS b;`
 * returns `[{"b":2}]`). A probe that ends in a DO block, or that concatenates
 * two assertion SELECTs, silently discards assertions — and "0/0 passed,
 * exit 0" is the one result a test harness must never print. So: no rows, or
 * rows without the (probe, ok, detail) columns, is a failure.
 *
 * AUTH. SUPABASE_PAT (this repo's TS-side name, import-templates-to-staging.ts),
 * else SUPABASE_ACCESS_TOKEN (what scripts/db/mgmt-api.sh and CI use), else the
 * macOS keychain item "Supabase CLI" with its go-keyring-base64 prefix decoded —
 * the same resolution scripts/verify-migration-applied.ts uses. The token goes
 * into an Authorization header and is never logged.
 *
 * EXIT CODES. 0 every assertion passed · 1 at least one assertion failed ·
 * 2 usage error or interlock refusal (nothing was sent) · 3 no assertion rows
 * came back · 5 the Management API returned an error (the same code
 * mgmt-api.sh's mgmt_query uses), printed verbatim.
 *
 * Two harnesses, two contracts, both valid: item 2's try-work-item-spine.sh
 * stacks 00195 + 00196 + one RAISE-style assertion file and expects NO rows (a
 * failure is a RAISE); this one expects (probe, ok, detail) rows. Do not merge
 * them.
 */
import { readFileSync, writeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'

const EXIT = { pass: 0, failed: 1, usage: 2, noRows: 3, api: 5 } as const

const USAGE =
  'usage: rehearse-sql.ts <probe.sql> [--with <migration.sql>]…\n' +
  '  --with is repeatable; files apply first, in the order given, in the same rolled-back transaction.'

function die(code: number, message: string): never {
  // Synchronous write: on macOS a piped stderr is asynchronous and process.exit
  // would cut the message short.
  writeSync(2, `${message}\n`)
  process.exit(code)
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') die(EXIT.usage, USAGE)

const probePath = args[0].startsWith('--') ? null : args[0]
if (!probePath) die(EXIT.usage, `the first argument must be the probe file, got "${args[0]}"\n${USAGE}`)

// Repeatable --with; anything else is a usage error rather than silently ignored.
const withPaths: string[] = []
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--with') {
    const value = args[i + 1]
    if (!value || value.startsWith('--')) die(EXIT.usage, `--with needs a file after it\n${USAGE}`)
    withPaths.push(value)
    i++
  } else {
    die(EXIT.usage, `unknown argument "${args[i]}"\n${USAGE}`)
  }
}

function readSql(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    return die(EXIT.usage, `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// Each segment remembers where it starts in the concatenated body so an
// interlock refusal can name the file and line, not just "somewhere".
type Segment = { label: string; startLine: number }
const segments: Segment[] = []
const parts: string[] = []
let lineCursor = 1
function push(label: string, text: string) {
  segments.push({ label, startLine: lineCursor })
  parts.push(text)
  lineCursor += text.split('\n').length // join('\n') below adds exactly one line per boundary
}
// The sequence guard's two halves — see RFI-NUMBER SEQUENCE GUARD in the header.
// Both operands are captured here, before any --with file or probe has run.
const SEQ_CAPTURE = `CREATE TEMP TABLE _rehearse_seq_guard AS
SELECT s.last_value, s.is_called,
       (SELECT pg_catalog.max(r.rfi_number) FROM projects.rfis r) AS max_rfi_number
  FROM projects.rfis_rfi_number_seq s;`
// RESET ROLE first: a probe that ends impersonating would not be able to
// setval() the sequence, and that error would abort the transaction and throw
// away the probe's rows (exit 5) instead of reporting them.
const SEQ_RESTORE = `RESET ROLE;
DO $_rehearse_seq_restore$
BEGIN
  PERFORM pg_catalog.setval(
    'projects.rfis_rfi_number_seq',
    GREATEST((SELECT g.last_value FROM _rehearse_seq_guard g),
             COALESCE((SELECT g.max_rfi_number FROM _rehearse_seq_guard g), 0)),
    true);
END
$_rehearse_seq_restore$;`

push('<harness>', `BEGIN;\n${SEQ_CAPTURE}`)
for (const p of withPaths) push(p, readSql(p))
push(probePath, readSql(probePath))
push('<harness:seq-restore>', SEQ_RESTORE)
const body = parts.join('\n')

function locate(index: number): string {
  const line = body.slice(0, index).split('\n').length
  let seg = segments[0]
  for (const s of segments) if (s.startLine <= line) seg = s
  return `${seg.label}:${line - seg.startLine + 1}`
}

// ---------------------------------------------------------------------------
// Safety interlock — runs before the token is read and before any request.
// ---------------------------------------------------------------------------
function refuse(what: string, index: number): never {
  return die(
    EXIT.usage,
    `Error: refusing to run: input contains ${what}. This harness only rehearses.\n  at ${locate(index)}`,
  )
}

// Everything the interlock inspects is the input with comments, string
// literals, quoted identifiers and dollar-quoted bodies blanked to spaces in a
// single left-to-right pass (length and newlines preserved, so an index still
// maps to a file:line). One pass, not two — see the header for the hole each
// two-phase ordering has.
function blankLiteralsAndComments(src: string): string {
  const n = src.length
  let out = ''
  let i = 0
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ')
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '-' && d === '-') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && d === '*') {
      let depth = 0 // PostgreSQL block comments nest
      do {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2 }
        else if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2 }
        else { out += blank(src[i]); i++ }
      } while (i < n && depth > 0)
      continue
    }
    if (c === "'" || c === '"') {
      const q = c
      // E'…' strings honour backslash escapes; plain strings only double the quote.
      const escapes = q === "'" && /[eE]/.test(src[i - 1] ?? '') && !/[\w$]/.test(src[i - 2] ?? '')
      out += ' '; i++
      while (i < n) {
        // A backslash escape consumes two characters; keep a newline as a
        // newline so `at file:line` does not drift after a `\` + newline.
        if (escapes && src[i] === '\\') { out += ' ' + (i + 1 < n ? blank(src[i + 1]) : ''); i += 2; continue }
        if (src[i] === q) {
          if (src[i + 1] === q) { out += '  '; i += 2; continue }
          out += ' '; i++; break
        }
        out += blank(src[i]); i++
      }
      continue
    }
    // Identifiers are consumed whole, ahead of the dollar-quote test:
    // PostgreSQL's ident_cont includes `$`, so `foo$bar$` is ONE identifier and
    // not the opening of a $bar$ quote (which would blank everything up to the
    // next $bar$, COMMIT included). Keywords pass through verbatim, so the
    // checks below still see COMMIT / END / PREPARE and the ON COMMIT clause.
    if (/[A-Za-z_-￿]/.test(c)) {
      while (i < n && /[A-Za-z0-9_$-￿]/.test(src[i])) { out += src[i]; i++ }
      continue
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(src.slice(i))?.[0]
      if (tag) {
        const close = src.indexOf(tag, i + tag.length)
        const stop = close === -1 ? n : close + tag.length
        for (let k = i; k < stop; k++) out += blank(src[k])
        i = stop
        continue
      }
    }
    out += c
    i++
  }
  return out
}
// The temp-table clause is the one place COMMIT is legal in a probe; it is
// blanked before the check so it cannot trip it.
const ON_COMMIT_CLAUSE = /\bON\s+COMMIT\s+(?:DROP|DELETE\s+ROWS|PRESERVE\s+ROWS)\b/gi
const bare = blankLiteralsAndComments(body).replace(ON_COMMIT_CLAUSE, (m) => ' '.repeat(m.length))

// 1. COMMIT as a token that could execute.
{
  const m = /\bCOMMIT\b/i.exec(bare)
  if (m) refuse('COMMIT', m.index)
}
// 2. PREPARE TRANSACTION.
{
  const m = /\bPREPARE\s+TRANSACTION\b/i.exec(bare)
  if (m) refuse('PREPARE TRANSACTION', m.index)
}
// 3. A top-level END statement. END is only findable by position — every DO
//    block has one inside its dollar quotes, and those are blanked — so the
//    remaining text is split on ';' and the first keyword of each statement is
//    read. A statement that begins with END is a COMMIT.
{
  let offset = 0
  for (const stmt of bare.split(';')) {
    const kw = /^\s*([A-Za-z_]+)/.exec(stmt)
    if (kw && kw[1].toUpperCase() === 'END') {
      refuse('a top-level END statement (PostgreSQL treats END as COMMIT)', offset + kw.index + kw[0].length - kw[1].length)
    }
    offset += stmt.length + 1
  }
}

const sql = `${body}\nROLLBACK;`

// ---------------------------------------------------------------------------
// Token — the same resolution scripts/verify-migration-applied.ts uses, with
// SUPABASE_PAT accepted first. Never printed.
// ---------------------------------------------------------------------------
function pat(): string {
  const fromEnv = process.env.SUPABASE_PAT?.trim() || process.env.SUPABASE_ACCESS_TOKEN?.trim()
  if (fromEnv) return fromEnv
  let raw: string
  try {
    raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return die(
      EXIT.usage,
      'SUPABASE_PAT / SUPABASE_ACCESS_TOKEN are unset and the "Supabase CLI" keychain item could not be read',
    )
  }
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim()
    : raw
}

// ---------------------------------------------------------------------------
// The one request.
// ---------------------------------------------------------------------------
const stacked = withPaths.length ? ` (with ${withPaths.join(', ')})` : ''
console.error(`rehearsing ${probePath}${stacked} against ${PROJECT_REF} — rolled back`)

let res: Response
let text: string
try {
  res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  text = await res.text()
} catch (e) {
  die(EXIT.api, `request failed before a response arrived: ${e instanceof Error ? e.message : String(e)}`)
}

// The API's error text, verbatim. An error is a JSON object with a `message`
// (the SQL error, CONTEXT lines and all); anything else is printed raw.
function errorText(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.message === 'string') {
      return parsed.message
    }
  } catch {
    /* not JSON — print raw */
  }
  return raw
}

if (!res.ok) die(EXIT.api, `Management API error (HTTP ${res.status}):\n${errorText(text)}`)

let parsed: unknown
try {
  parsed = JSON.parse(text)
} catch {
  die(EXIT.api, `Management API returned non-JSON (HTTP ${res.status}):\n${text.slice(0, 2000)}`)
}
// A 200 can still carry an error object rather than a row array.
if (!Array.isArray(parsed)) die(EXIT.api, `Management API error (HTTP ${res.status}):\n${errorText(text)}`)

const rows = parsed as Array<Record<string, unknown>>
if (rows.length === 0) {
  die(
    EXIT.noRows,
    'no assertion rows returned. A probe file must end in exactly one row-producing\n' +
      'statement selecting (probe text, ok boolean, detail text). Got:\n' +
      JSON.stringify(rows).slice(0, 600),
  )
}
const shaped = rows.every(
  (r) => r !== null && typeof r === 'object' && 'probe' in r && 'ok' in r && 'detail' in r,
)
if (!shaped) {
  die(
    EXIT.noRows,
    'the last row-producing statement did not select (probe text, ok boolean, detail text).\n' +
      'Either the probe ends in the wrong statement or a --with file, not the probe, produced the rows. Got:\n' +
      JSON.stringify(rows).slice(0, 600),
  )
}

let failed = 0
for (const r of rows) {
  const ok = r.ok === true
  if (!ok) failed++
  // A NULL ok (e.g. `NULL = 1`) is a FAIL and says so, not a silently coerced false.
  const verdict = ok ? 'PASS' : r.ok === false ? 'FAIL' : `FAIL (ok=${JSON.stringify(r.ok)})`
  console.log(`${verdict}  ${r.probe}  ${r.detail ?? ''}`)
}
// Print the names seen, so a silently-dropped assertion is visible in the
// output and not only in a total the reader has to remember.
console.log(`\nassertions seen: ${rows.map((r) => r.probe).join(', ')}`)
console.log(`${rows.length - failed}/${rows.length} assertions passed`)
// exitCode, not process.exit(): a piped stdout is asynchronous on macOS and an
// immediate exit could cut the rows above short.
process.exitCode = failed === 0 ? EXIT.pass : EXIT.failed
