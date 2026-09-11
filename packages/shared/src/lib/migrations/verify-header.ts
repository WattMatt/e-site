// packages/shared/src/lib/migrations/verify-header.ts
//
// The `-- @verify:` block convention. One place defines the grammar.
//
// It exists because `supabase db push` keys on the version PREFIX: a number
// already present in supabase_migrations.schema_migrations makes it print
// "Remote database is up to date", exit 0 and SKIP the file. PR #163's
// migration never applied behind a green workflow for exactly that reason.
// A green deploy is not evidence a migration ran; reading the object back is.
//
// This module is PURE — no I/O, no node built-ins — so it is safe to re-export
// from the package barrel. The half that talks to a database lives in the CLI.

/** A `column:` directive may assert more than mere existence. */
export type ColumnAssertion = 'generated_always_stored'

/**
 * A `policy:` directive may assert which KIND of policy it is. This is not a
 * detail: a RESTRICTIVE policy narrows, a PERMISSIVE one widens, and shipping
 * one as the other inverts the gate while every existence check stays green.
 * Both 00171 (membership writes) and 00183 (saved-report reads) turned on
 * exactly this distinction.
 */
export type PolicyAssertion = 'restrictive' | 'permissive'

interface DirectiveMeta {
  /** 1-based line number in the file the block was parsed from. */
  line: number
  /** The verbatim source line, so an error can point at what a reviewer sees. */
  raw: string
  /**
   * Prose attached to the directive and never part of what is asserted:
   * trailing `-- note` text after the payload, plus any indented wrapped
   * lines that follow a directive whose kind does NOT wrap its payload.
   *
   * For the kinds in PAYLOAD_WRAPS (`behaviour`, `anon_execute_absent`,
   * `sql`) a wrapped line extends the PAYLOAD instead and never lands here.
   * The one exception in the other direction: on a `policy:` directive a
   * trailing note of exactly RESTRICTIVE or PERMISSIVE is promoted to
   * `assertion` and does not appear here — 00192 writes it that way.
   */
  comment?: string
}

export type VerifyDirective =
  | ({ kind: 'table' | 'view'; schema: string; name: string } & DirectiveMeta)
  | ({ kind: 'function'; schema: string; name: string; args: string } & DirectiveMeta)
  | ({ kind: 'column'; schema: string; table: string; column: string; assertion: ColumnAssertion | null } & DirectiveMeta)
  | ({ kind: 'policy'; name: string; schema: string; table: string; assertion: PolicyAssertion | null } & DirectiveMeta)
  | ({ kind: 'constraint' | 'index' | 'trigger'; name: string; schema: string; table: string } & DirectiveMeta)
  | ({ kind: 'cron'; jobname: string } & DirectiveMeta)
  | ({ kind: 'grant_absent' | 'grant_present'; role: string; privilege: string; target: string } & DirectiveMeta)
  | ({ kind: 'sql'; predicate: string } & DirectiveMeta)
  | ({ kind: 'anon_execute_absent'; schemas: string[] } & DirectiveMeta)
  | ({ kind: 'behaviour'; description: string } & DirectiveMeta)

const BEGIN = /^--\s*@verify:begin\s*$/
const END = /^--\s*@verify:end\s*$/

/** `-- <kind>: <payload>` at normal (single-space) comment indentation. */
const DIRECTIVE = /^--\s*([a-z_]+)\s*:\s*(.+?)\s*$/

/**
 * A wrapped line: indented two or more spaces past the `--`. 00192 has four,
 * 00186 two.
 *
 * What protects against typos is NOT this indentation. It is that DIRECTIVE is
 * tried FIRST, so anything of the shape `-- word: payload` is a directive and a
 * misspelt KIND (`-- polciy: …`) reaches the unknown-kind arm and throws. The
 * two-space rule covers the other half: a line that is not directive-shaped at
 * all, such as `-- table public.t` with the colon dropped. Widen this to `\s+`
 * or `\s*` and that line is silently filed as prose, leaving a block that
 * looks full and asserts nothing.
 */
const CONTINUATION = /^--\s{2,}\S/

/**
 * Kinds whose payload is a list or free text and therefore genuinely wraps, so
 * a continuation line EXTENDS the payload. 00186's anon_execute_absent carries
 * eight of its eleven schemas on wrapped lines; filing those as a note would
 * leave eight schemas unswept while the check still reported green.
 *
 * Every other kind's payload is a single identifier or signature and never
 * wraps, so a wrapped line after one is prose — 00192 has four such lines
 * under a grant_absent. Gluing them into the payload would corrupt the target.
 * The two cases are not distinguishable from the text alone; the kind decides.
 */
const PAYLOAD_WRAPS = new Set(['behaviour', 'anon_execute_absent', 'sql'])

const IDENTIFIER = /^[a-z0-9_]+$/i

/**
 * Every identifier reaching a predicate is checked against IDENTIFIER first.
 * Quoting is not the concern — `q()` already escapes, and these strings come
 * from files a reviewer reads. The concern is a MIS-PARSE: a folded note or a
 * dropped delimiter yields a name like `t"; DROP TABLE x;`, which builds a
 * predicate that can never be true. The run then fails for the wrong reason
 * and hides whether the migration actually applied — worse than a parse error,
 * because someone will re-deploy chasing the wrong thing.
 */
function requireIdentifier(s: string, line: number, raw: string): string {
  if (!IDENTIFIER.test(s)) {
    throw new Error(`@verify line ${line}: "${s}" is not a bare identifier — ${raw}`)
  }
  return s
}

function splitQualified(s: string, expected: number, line: number, raw: string): string[] {
  const parts = s.trim().split('.')
  if (parts.length !== expected || parts.some((p) => p.length === 0)) {
    throw new Error(`@verify line ${line}: expected ${expected} dot-separated parts in "${s}" — ${raw}`)
  }
  return parts.map((p) => requireIdentifier(p, line, raw))
}

/**
 * Splits a trailing `  -- note` off the payload.
 *
 * NOT applied to `sql:` payloads: those are interpolated verbatim, so cutting
 * one at a `--` would silently change what is asserted.
 */
function splitTrailingComment(payload: string): { body: string; comment?: string } {
  const m = payload.match(/^(.*?)\s+--\s*(.*)$/)
  if (!m) return { body: payload.trim() }
  return { body: m[1].trim(), comment: m[2].trim() || undefined }
}

function parsePolicyAssertion(text: string, line: number, raw: string): PolicyAssertion {
  const t = text.trim().toUpperCase()
  if (t === 'RESTRICTIVE') return 'restrictive'
  if (t === 'PERMISSIVE') return 'permissive'
  throw new Error(
    `@verify line ${line}: unrecognised policy assertion "${text}" — expected RESTRICTIVE ` +
      `or PERMISSIVE — ${raw}`,
  )
}

function parseColumnAssertion(text: string, line: number, raw: string): ColumnAssertion {
  if (/^is\s+generated\s+always(\s+as\s+.*?)?\s+stored$/i.test(text)) return 'generated_always_stored'
  throw new Error(
    `@verify line ${line}: unrecognised column assertion "${text}" — this parser can only check ` +
      `"is GENERATED ALWAYS STORED"; use a sql: directive for anything else — ${raw}`,
  )
}

/**
 * Returns the directives in file order, or null when the file carries no block.
 * Throws — never returns a partial result — on a malformed block, because a
 * block nobody can parse is the same as no block at all and must not pass CI.
 */
export function parseVerifyBlock(sql: string): VerifyDirective[] | null {
  const lines = sql.split(/\r?\n/)
  const start = lines.findIndex((l) => BEGIN.test(l.trim()))
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && END.test(l.trim()))
  if (end === -1) throw new Error('@verify:begin with no matching @verify:end')
  // One block per file. Silently parsing only the first would let a second
  // block's directives assert nothing while looking like they do.
  const stray = lines.findIndex((l, i) => i > end && BEGIN.test(l.trim()))
  if (stray !== -1) {
    throw new Error(
      `@verify line ${stray + 1}: a second @verify:begin — one block per migration; ` +
        'merge the directives into the first block',
    )
  }

  // ── Pass 1: fold physically wrapped lines into logical directives ────────
  interface Folded { kind: string; payload: string; note: string; line: number; raw: string }
  const folded: Folded[] = []

  for (let i = start + 1; i < end; i++) {
    const raw = lines[i]
    const body = raw.trim()
    const line = i + 1
    if (body === '--' || body === '') continue

    const m = body.match(DIRECTIVE)

    if (!m) {
      if (CONTINUATION.test(body)) {
        const prev = folded[folded.length - 1]
        if (!prev) throw new Error(`@verify line ${line}: continuation line with no directive above it — ${raw}`)
        const text = body.slice(2).trim()
        if (PAYLOAD_WRAPS.has(prev.kind)) prev.payload = `${prev.payload} ${text}`
        else prev.note = prev.note ? `${prev.note} ${text}` : text
        continue
      }
      throw new Error(`@verify line ${line}: not a directive — ${raw}`)
    }

    folded.push({ kind: m[1], payload: m[2], note: '', line, raw })
  }

  // ── Pass 2: parse each logical directive ─────────────────────────────────
  const out: VerifyDirective[] = []
  for (const f of folded) {
    const { kind, line, raw } = f
    // `sql` keeps its payload byte-for-byte; everything else may carry a note.
    const split = kind === 'sql' ? { body: f.payload.trim(), comment: undefined } : splitTrailingComment(f.payload)
    const rest = split.body
    const comment = [split.comment, f.note].filter(Boolean).join(' ') || undefined
    const meta: DirectiveMeta = comment ? { line, raw, comment } : { line, raw }

    switch (kind) {
      case 'table':
      case 'view': {
        const [schema, name] = splitQualified(rest, 2, line, raw)
        out.push({ kind, schema, name, ...meta })
        break
      }
      case 'function': {
        const fm = rest.match(/^([a-z0-9_]+)\.([a-z0-9_]+)\s*\((.*)\)$/i)
        if (!fm) throw new Error(`@verify line ${line}: expected schema.name(argtypes) — ${raw}`)
        out.push({ kind, schema: fm[1], name: fm[2], args: fm[3].trim(), ...meta })
        break
      }
      case 'column': {
        // `<schema>.<table>.<column>` optionally followed by an assertion
        // phrase. The identifier stops at the first space — without that,
        // 00192's "…total_length_m is GENERATED ALWAYS STORED" would parse as
        // a column literally named "total_length_m is GENERATED ALWAYS STORED"
        // and the directive could never go red.
        const [qualified, ...tail] = rest.split(/\s+/)
        const [schema, table, column] = splitQualified(qualified, 3, line, raw)
        const assertion = tail.length ? parseColumnAssertion(tail.join(' '), line, raw) : null
        out.push({ kind, schema, table, column, assertion, ...meta })
        break
      }
      case 'policy': {
        // `<name> ON <schema>.<table>` optionally followed by RESTRICTIVE or
        // PERMISSIVE — either as a bare trailing word, or (the form 00192 uses
        // on six policies) as a trailing `-- RESTRICTIVE` note.
        const pm = rest.match(/^(\S+)\s+ON\s+(\S+)(?:\s+(\S+))?$/i)
        if (!pm) throw new Error(`@verify line ${line}: expected "<name> ON <schema>.<table>" — ${raw}`)
        const [pSchema, pTable] = splitQualified(pm[2], 2, line, raw)
        let assertion: PolicyAssertion | null = null
        let pComment = comment
        if (pm[3]) {
          assertion = parsePolicyAssertion(pm[3], line, raw)
        } else if (comment && /^(restrictive|permissive)$/i.test(comment.trim())) {
          // Only these two words are promoted. Any other note stays prose, or
          // every explanatory comment on a policy becomes a parse error.
          assertion = parsePolicyAssertion(comment, line, raw)
          pComment = undefined
        }
        out.push({
          kind,
          name: requireIdentifier(pm[1], line, raw),
          schema: pSchema,
          table: pTable,
          assertion,
          line,
          raw,
          ...(pComment ? { comment: pComment } : {}),
        })
        break
      }
      case 'constraint':
      case 'index':
      case 'trigger': {
        const om = rest.match(/^(\S+)\s+ON\s+(\S+)$/i)
        if (!om) throw new Error(`@verify line ${line}: expected "<name> ON <schema>.<table>" — ${raw}`)
        const [schema, table] = splitQualified(om[2], 2, line, raw)
        out.push({ kind, name: requireIdentifier(om[1], line, raw), schema, table, ...meta })
        break
      }
      case 'cron': {
        out.push({ kind, jobname: rest, ...meta })
        break
      }
      case 'grant_absent':
      case 'grant_present': {
        const gm = rest.match(/^(\S+)\s+(\S+)\s+ON\s+(.+)$/i)
        if (!gm) throw new Error(`@verify line ${line}: expected "<role> <PRIV> ON <object>" — ${raw}`)
        out.push({ kind, role: gm[1], privilege: gm[2].toUpperCase(), target: gm[3].trim(), ...meta })
        break
      }
      case 'sql': {
        out.push({ kind, predicate: rest, ...meta })
        break
      }
      case 'anon_execute_absent': {
        // 00186's database-wide sweep: no SECURITY DEFINER (prosecdef) function
        // in these schemas may leave anon holding EXECUTE. Supabase's bootstrap
        // ALTER DEFAULT PRIVILEGES grants anon EXECUTE *directly* at creation,
        // which REVOKE … FROM PUBLIC does not touch (the 00162 finding).
        const am = rest.match(/^ALL\s+prosecdef\s+functions\s+in\s+(.+)$/i)
        if (!am) throw new Error(`@verify line ${line}: expected "ALL prosecdef functions in <schema>, …" — ${raw}`)
        const schemas = am[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        const bad = schemas.find((s) => !IDENTIFIER.test(s))
        if (schemas.length === 0 || bad) {
          throw new Error(`@verify line ${line}: "${bad ?? ''}" is not a schema name — ${raw}`)
        }
        out.push({ kind, schemas, ...meta })
        break
      }
      case 'behaviour': {
        // Prose. 00192 carries five of these and 00186 four. They are NOT
        // machine-checkable and must never count as passed — see runDirectives.
        out.push({ kind, description: rest, ...meta })
        break
      }
      default:
        throw new Error(`@verify line ${line}: unknown directive "${kind}" — ${raw}`)
    }
  }
  if (out.length === 0) throw new Error('@verify block contains at least one directive: found none')
  if (!out.some(isCheckable)) {
    // behaviour: lines record what a human must confirm and assert nothing, so
    // a block of only prose runs clean: {passed: 0, failures: []}. A CLI doing
    // `if (failures.length === 0) exit(0)` then reports GREEN on a migration
    // that never ran — the same hole the empty-block guard above closes, worn
    // as a full-looking block.
    throw new Error(
      '@verify block contains at least one machine-checkable directive: found only prose ' +
        `(${out.map((d) => `${d.kind}:`).join(' ')})`,
    )
  }
  return out
}
// ---------------------------------------------------------------------------
// Predicate building and evaluation. Both halves are pure: the caller supplies
// the database.
// ---------------------------------------------------------------------------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * Builds a statement returning exactly one row with one boolean column `ok`,
 * or null when the directive is documentation rather than a check.
 */
export function buildPredicate(d: VerifyDirective): string | null {
  switch (d.kind) {
    case 'table':
      return `SELECT to_regclass(${q(`${d.schema}.${d.name}`)}) IS NOT NULL AS ok`
    case 'view':
      return `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ${q(d.schema)} AND c.relname = ${q(d.name)} AND c.relkind IN ('v','m')) AS ok`
    case 'function':
      // to_regprocedure parses a signature BY TYPE NAME and returns NULL for an
      // absent function, an absent schema and a wrong arity — verified against
      // production. NEVER compare pg_get_function_identity_arguments: it returns
      // NAMED arguments with comma-space ("p_project_id uuid, p_user_id uuid"),
      // so a string comparison is false for every real multi-argument function
      // and accidentally true only for the zero-argument case.
      return `SELECT to_regprocedure(${q(`${d.schema}.${d.name}(${d.args})`)}) IS NOT NULL AS ok`
    case 'column':
      // attgenerated, not information_schema: '' is a plain column, 's' a
      // STORED generated one. 00192's total_length_m exists either way, so an
      // existence-only check could not tell the promised column from a plain
      // numeric of the same name.
      return d.assertion === 'generated_always_stored'
        ? `SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = ${q(d.schema)} AND c.relname = ${q(d.table)} AND a.attname = ${q(d.column)}
                  AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = 's') AS ok`
        : `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = ${q(d.schema)} AND table_name = ${q(d.table)} AND column_name = ${q(d.column)}) AS ok`
    case 'policy':
      // pg_policies.permissive is the text 'PERMISSIVE' or 'RESTRICTIVE'.
      // Without this clause a RESTRICTIVE policy that shipped PERMISSIVE —
      // granting where it was meant to restrict — still reports green.
      return `SELECT EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = ${q(d.schema)} AND tablename = ${q(d.table)} AND policyname = ${q(d.name)}${
                d.assertion ? `\n                AND permissive = ${q(d.assertion.toUpperCase())}` : ''
              }) AS ok`
    case 'constraint':
      return `SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = ${q(d.schema)} AND t.relname = ${q(d.table)} AND c.conname = ${q(d.name)}) AS ok`
    case 'index':
      return `SELECT EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = ${q(d.schema)} AND tablename = ${q(d.table)} AND indexname = ${q(d.name)}) AS ok`
    case 'trigger':
      return `SELECT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid = tg.tgrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = ${q(d.schema)} AND t.relname = ${q(d.table)} AND tg.tgname = ${q(d.name)}
                AND NOT tg.tgisinternal) AS ok`
    case 'cron':
      return `SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ${q(d.jobname)} AND active) AS ok`
    case 'grant_absent':
    case 'grant_present': {
      // A function target carries parentheses; a table target does not.
      // has_*_privilege, never proacl: a NULL proacl looks empty but IS the
      // PUBLIC grant.
      const fn = d.target.includes('(') ? 'has_function_privilege' : 'has_table_privilege'
      const call = `${fn}(${q(d.role)}, ${q(d.target)}, ${q(d.privilege)})`
      return `SELECT ${d.kind === 'grant_absent' ? `NOT ${call}` : call} AS ok`
    }
    case 'anon_execute_absent':
      // 00186's sweep. prosecdef = SECURITY DEFINER; those are the functions
      // where an anon EXECUTE is a privilege escalation rather than a nuisance.
      return `SELECT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN (${d.schemas.map(q).join(', ')}) AND p.prosecdef
                AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS ok`
    case 'sql':
      return `SELECT (${d.predicate.replace(/;\s*$/, '')}) AS ok`
    case 'behaviour':
      // Prose for a human to verify. Reported as skipped, never as passed.
      return null
  }
}

/**
 * True when the directive has a predicate a database can answer. `behaviour:`
 * prose does not. The CLI must treat a set with no checkable directive as a
 * failure, not as a clean run — parseVerifyBlock already refuses to produce
 * one, but runDirectives can be called with any array.
 */
export function isCheckable(d: VerifyDirective): boolean {
  return buildPredicate(d) !== null
}

export type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>

export interface DirectiveFailure {
  directive: VerifyDirective
  reason: string
}

export interface RunResult {
  passed: number
  failures: DirectiveFailure[]
  /** Directives with no machine predicate — a human still has to check these. */
  skipped: VerifyDirective[]
}

/**
 * Evaluates every directive and reports EVERY failure, not the first — a
 * partial answer sends someone back for a second deploy round-trip.
 *
 * `passed + failures.length` is the number of directives actually checked;
 * `skipped` holds the prose. Zero checked is NOT a clean run — see isCheckable.
 *
 * ⚠ FOR THE CALLER: run each predicate in ITS OWN TRANSACTION.
 * has_table_privilege / has_function_privilege RAISE on an object that does
 * not exist rather than returning false. In the exact situation this tool
 * exists for — `supabase db push` skipped the file, so nothing was created —
 * most directives therefore raise. Batched into one transaction, the first
 * raise aborts it and every later directive comes back "current transaction is
 * aborted, commands ignored until end of transaction block", which masks the
 * real per-directive results behind one meaningless message.
 */
export async function runDirectives(directives: VerifyDirective[], query: QueryFn): Promise<RunResult> {
  const failures: DirectiveFailure[] = []
  const skipped: VerifyDirective[] = []
  let passed = 0
  for (const directive of directives) {
    const sql = buildPredicate(directive)
    if (sql === null) {
      skipped.push(directive)
      continue
    }
    try {
      const rows = await query(sql)
      if (!rows || rows.length === 0) {
        failures.push({ directive, reason: 'predicate returned no rows' })
        continue
      }
      // By NAME. buildPredicate always labels the column `ok`; reading by
      // position would let a driver that returns an extra column first turn a
      // result into its opposite. The positional read stays as a fallback for
      // a driver that drops labels entirely.
      const row = rows[0]
      const ok = 'ok' in row ? row.ok : row[Object.keys(row)[0]]
      // Strict === true. A NULL is not a true: to_regclass on an absent schema
      // and any un-COALESCEd expression both arrive here as null.
      if (ok === true) passed += 1
      else failures.push({ directive, reason: `predicate returned false (got ${JSON.stringify(ok)})` })
    } catch (e) {
      failures.push({ directive, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return { passed, failures, skipped }
}
