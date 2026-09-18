import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import {
  parseVerifyBlock, buildPredicate, runDirectives, isCheckable, type VerifyDirective,
} from './verify-header'

const SQL = `
  -- =============================================================================
  -- Migration 00186 — example
  -- =============================================================================
  -- @verify:begin
  -- table: public.product_events
  -- view: public.metric_accounts
  -- function: public.touch_presence(text,text)
  -- column: projects.project_settings.working_days
  -- policy: product_events_admin_only ON public.product_events
  -- constraint: platform_metrics_weekly_window ON public.platform_metrics_weekly
  -- index: platform_metrics_weekly_week_uk ON public.platform_metrics_weekly
  -- trigger: product_events_no_update ON public.product_events
  -- cron: platform-metrics-weekly
  -- grant_absent: anon SELECT ON public.product_events
  -- grant_absent: anon EXECUTE ON public.touch_presence(text,text)
  -- sql: SELECT count(*) >= 8 FROM projects.calendar_years
  -- @verify:end

  CREATE TABLE public.product_events (id uuid);
`

describe('parseVerifyBlock', () => {
  it('parses every directive kind in order', () => {
    const d = parseVerifyBlock(SQL)
    expect(d!.map((x) => x.kind)).toEqual([
      'table', 'view', 'function', 'column', 'policy', 'constraint',
      'index', 'trigger', 'cron', 'grant_absent', 'grant_absent', 'sql',
    ])
    expect(d![0]).toMatchObject({ kind: 'table', schema: 'public', name: 'product_events' })
    expect(d![2]).toMatchObject({ kind: 'function', schema: 'public', name: 'touch_presence', args: 'text,text' })
    expect(d![4]).toMatchObject({ kind: 'policy', name: 'product_events_admin_only', schema: 'public', table: 'product_events' })
    expect(d![9]).toMatchObject({ kind: 'grant_absent', role: 'anon', privilege: 'SELECT' })
    expect(d![11]).toMatchObject({ kind: 'sql', predicate: 'SELECT count(*) >= 8 FROM projects.calendar_years' })
  })

  it('returns null when there is no block at all', () => {
    expect(parseVerifyBlock('-- just a migration\nCREATE TABLE t (id int);')).toBeNull()
  })

  it('throws on a block that is opened and never closed', () => {
    expect(() => parseVerifyBlock('-- @verify:begin\n-- table: public.t\n')).toThrow(/@verify:end/)
  })

  it('throws naming the line on an unknown directive', () => {
    expect(() =>
      parseVerifyBlock('-- @verify:begin\n-- tabel: public.t\n-- @verify:end'),
    ).toThrow(/tabel/)
  })

  it('throws when a sql: continuation line is prose rather than SQL (the 00204 trap)', () => {
    // 00204 shipped this to production. A `sql:` payload is executed
    // byte-for-byte as SELECT (<payload>) and its continuation lines are FOLDED
    // IN, so the explanatory sentence became part of the query and the deploy
    // died at the post-push verify step with `42601: syntax error at or near "("`
    // — after the migration had already applied.
    expect(() =>
      parseVerifyBlock(
        [
          '-- @verify:begin',
          "-- sql: public.user_has_project_access('00000000-0000-0000-0000-000000000000'::uuid) IS FALSE",
          '--        (no session: auth.uid() is NULL, so the helper must answer FALSE, never NULL —',
          '--        data-independent, a NULL user matches no membership row)',
          '-- @verify:end',
        ].join('\n'),
      ),
    ).toThrow(/em dash outside a string literal/)
  })

  it('accepts the same sentence once it is wrapped in a SQL block comment', () => {
    const d = parseVerifyBlock(
      [
        '-- @verify:begin',
        "-- sql: public.user_has_project_access('00000000-0000-0000-0000-000000000000'::uuid) IS FALSE",
        '--        /* no session: auth.uid() is NULL, so the helper must answer FALSE, never',
        '--           NULL - data-independent, a NULL user matches no membership row */',
        '-- @verify:end',
      ].join('\n'),
    )
    expect(d).toHaveLength(1)
    expect(d![0].kind).toBe('sql')
  })

  it('does not reject an em dash that is inside a string literal', () => {
    // A predicate may legitimately compare against text that contains one —
    // a COMMENT body, for instance — and that is valid SQL.
    const d = parseVerifyBlock(
      [
        '-- @verify:begin',
        "-- sql: (SELECT obj_description('public.t'::regclass) LIKE '%a — b%')",
        '-- @verify:end',
      ].join('\n'),
    )
    expect(d).toHaveLength(1)
  })

  it('throws on a block with no directives — an empty block is decorative', () => {
    expect(() => parseVerifyBlock('-- @verify:begin\n-- @verify:end')).toThrow(/at least one directive/)
  })
})

// ---------------------------------------------------------------------------
// The forms the FOUR production migrations actually use — 00185, 00186, 00188
// and 00192. All four shipped before this parser existed, so the grammar has to
// meet them where they are rather than the other way round. Each fixture below
// is a verbatim line from one of those files.
// ---------------------------------------------------------------------------

const block = (...lines: string[]) =>
  parseVerifyBlock(['-- @verify:begin', ...lines, '-- @verify:end'].join('\n'))

describe('parseVerifyBlock — production directive forms', () => {
  it('keeps a trailing "-- comment" out of the payload, and keeps it', () => {
    // 00192:61 — the payload must NOT absorb the trailing note, or the index
    // name becomes "route_segments_route_id_seq_key ON …  -- the UNIQUE…".
    const d = block(
      '-- index: route_segments_route_id_seq_key ON cable_schedule.route_segments  -- the UNIQUE constraint IS the (route_id, seq) index; no duplicate created',
    )
    expect(d![0]).toMatchObject({
      kind: 'index',
      name: 'route_segments_route_id_seq_key',
      schema: 'cable_schedule',
      table: 'route_segments',
      comment: 'the UNIQUE constraint IS the (route_id, seq) index; no duplicate created',
    })
  })

  it('keeps a trailing note off a policy name', () => {
    const d = block('-- policy: route_write_authz_insert ON cable_schedule.supply_routes  -- see 00177')
    expect(d![0]).toMatchObject({ kind: 'policy', name: 'route_write_authz_insert', comment: 'see 00177' })
  })

  it('does NOT strip a "--" that is part of a sql predicate', () => {
    // A sql directive is interpolated verbatim; truncating it at a "--" would
    // silently change what is asserted, which is the whole failure class here.
    const d = block("-- sql: SELECT count(*) = 0 FROM t WHERE note <> '-- x'")
    expect(d![0]).toMatchObject({ kind: 'sql', predicate: "SELECT count(*) = 0 FROM t WHERE note <> '-- x'" })
  })

  it('treats an indented wrapped line as a continuation, not as a new directive', () => {
    // 00192:107-109 — four indented prose lines follow the last grant_absent.
    const d = block(
      '-- grant_absent: anon EXECUTE ON cable_schedule.recompute_route_traced_length()',
      "--   (all five via has_function_privilege('anon', oid, 'EXECUTE') = false, never",
      '--    by reading proacl — a NULL proacl looks empty but IS the PUBLIC grant)',
    )
    expect(d).toHaveLength(1)
    expect(d![0]).toMatchObject({
      kind: 'grant_absent',
      role: 'anon',
      privilege: 'EXECUTE',
      target: 'cable_schedule.recompute_route_traced_length()',
    })
    expect(d![0].comment).toMatch(/never by reading proacl/)
  })

  it('throws on a well-formed directive whose KIND is misspelt', () => {
    // Nothing to do with the continuation rule: this line is directive-shaped,
    // so DIRECTIVE matches it first and the unknown-kind arm rejects it. The
    // swallow-anything property is pinned by the next test, not this one.
    expect(() => block('-- table: public.t', '-- polciy: p ON public.t')).toThrow(/polciy/)
  })

  it('throws on a colon-less line at NORMAL indentation — the swallow-anything guard', () => {
    // `-- table public.t`, the colon dropped, at the same one-space indent every
    // real directive uses. This is the only fixture that can detect CONTINUATION
    // being widened: at \s{2,} it throws, at \s+ or \s* it is absorbed as prose
    // and the table is never checked — a block that looks full and asserts
    // nothing, which is the decorative-check failure exactly.
    expect(() => block('-- table: public.t', '-- table public.other')).toThrow(/not a directive/)
  })

  it('throws on a continuation with no directive to continue', () => {
    expect(() => block('--    orphaned wrapped prose')).toThrow(/continuation/)
  })

  it('parses grant_present — 00192 asserts grants exist as well as absent', () => {
    const d = block('-- grant_present: authenticated EXECUTE ON cable_schedule.user_can_edit_schedule(uuid)')
    expect(d![0]).toMatchObject({
      kind: 'grant_present',
      role: 'authenticated',
      privilege: 'EXECUTE',
      target: 'cable_schedule.user_can_edit_schedule(uuid)',
    })
  })

  it('parses a behaviour directive as prose, joining its wrapped line', () => {
    const d = block(
      '-- table: cable_schedule.route_segments',
      '-- behaviour: INSERT/UPDATE/DELETE of a segment -> parent traced_length_m and',
      '--            total_length_m recomputed in the same statement',
    )
    expect(d).toHaveLength(2)
    expect(d![1]).toMatchObject({
      kind: 'behaviour',
      description:
        'INSERT/UPDATE/DELETE of a segment -> parent traced_length_m and total_length_m recomputed in the same statement',
    })
  })

  it('parses a column directive carrying the GENERATED ALWAYS STORED assertion', () => {
    // 00192:58. The column name must stop at the whitespace; the assertion is
    // a separate, checkable fact rather than part of the identifier.
    const d = block('-- column: cable_schedule.supply_routes.total_length_m is GENERATED ALWAYS STORED')
    expect(d![0]).toMatchObject({
      kind: 'column',
      schema: 'cable_schedule',
      table: 'supply_routes',
      column: 'total_length_m',
      assertion: 'generated_always_stored',
    })
  })

  it('a plain column directive carries no assertion', () => {
    const d = block('-- column: projects.project_settings.working_days')
    expect(d![0]).toMatchObject({ kind: 'column', column: 'working_days', assertion: null })
  })

  it('throws on a column assertion it cannot check, rather than ignoring it', () => {
    expect(() => block('-- column: public.t.c is PROBABLY FINE')).toThrow(/PROBABLY FINE/)
  })

  it('tolerates the padded columns 00186 uses to align its role names', () => {
    const d = block('-- grant_absent:  authenticated EXECUTE ON public.project_notification_recipients(uuid,uuid)')
    expect(d![0]).toMatchObject({ kind: 'grant_absent', role: 'authenticated', privilege: 'EXECUTE' })
    const e = block('-- grant_present: service_role  EXECUTE ON projects.jbcc_allocate_letter_reference(uuid)')
    expect(e![0]).toMatchObject({ kind: 'grant_present', role: 'service_role', privilege: 'EXECUTE' })
  })

  it('carries a WRAPPED schema list into the payload — a dropped schema is an unswept schema', () => {
    // 00186:104-106 verbatim. Eleven schemas, eight of them on wrapped lines.
    // If the wrap were filed as a note the sweep would silently cover three
    // schemas and still report green — the exact shape of defect this tool
    // exists to catch.
    const d = block(
      '-- anon_execute_absent: ALL prosecdef functions in public, projects, inspections,',
      '--     field, tenants, suppliers, billing, marketplace, cable_schedule,',
      "--     structure, gcr  -- has_function_privilege('anon', oid, 'EXECUTE') = false",
    )
    expect(d).toHaveLength(1)
    expect(d![0]).toMatchObject({ kind: 'anon_execute_absent' })
    expect((d![0] as { schemas: string[] }).schemas).toEqual([
      'public', 'projects', 'inspections', 'field', 'tenants', 'suppliers',
      'billing', 'marketplace', 'cable_schedule', 'structure', 'gcr',
    ])
    expect(d![0].comment).toBe("has_function_privilege('anon', oid, 'EXECUTE') = false")
  })

  it('throws on an anon_execute_absent payload it does not understand', () => {
    expect(() => block('-- anon_execute_absent: every function everywhere')).toThrow(/prosecdef/)
  })

  // ── behaviour-only blocks: the hole the empty-block guard left open ──────

  it('throws on a block of nothing but behaviour prose', () => {
    // Two behaviour lines parse, run, and report {passed: 0, failures: []}.
    // A CLI doing `if (failures.length === 0) exit(0)` then calls a migration
    // that never ran GREEN. Prose is not a check; a block of only prose is an
    // empty block wearing a coat.
    expect(() =>
      block(
        '-- behaviour: contractor INSERT on either table -> denied',
        '-- behaviour: owner INSERT on a DRAFT revision -> allowed',
      ),
    ).toThrow(/machine-checkable/)
  })

  it('accepts behaviour prose alongside one real check — 00186 does exactly this', () => {
    const d = block(
      '-- grant_present: authenticated EXECUTE ON public.has_feature(uuid,text)',
      '-- behaviour: anon INSERT on public.user_organisations still denied',
    )
    expect(d).toHaveLength(2)
    expect(d!.filter((x) => isCheckable(x))).toHaveLength(1)
  })

  // ── PERMISSIVE vs RESTRICTIVE: twice the security boundary in this repo ──

  it('reads 00192\'s trailing "-- RESTRICTIVE" as an assertion, not as prose', () => {
    // Verbatim 00192:69. A RESTRICTIVE policy that ships PERMISSIVE grants
    // where it was meant to restrict — 00171 and 00183 both turned on this —
    // and an existence-only check reports green either way.
    const d = block('-- policy: route_write_authz_insert ON cable_schedule.supply_routes  -- RESTRICTIVE')
    expect(d![0]).toMatchObject({ kind: 'policy', name: 'route_write_authz_insert', assertion: 'restrictive' })
  })

  it('accepts the assertion as a bare trailing word too', () => {
    expect(block('-- policy: p ON s.t RESTRICTIVE')![0]).toMatchObject({ assertion: 'restrictive' })
    expect(block('-- policy: p ON s.t PERMISSIVE')![0]).toMatchObject({ assertion: 'permissive' })
  })

  it('a policy with no assertion carries none', () => {
    expect(block('-- policy: email_events_org_admin_read ON public.email_events')![0])
      .toMatchObject({ kind: 'policy', assertion: null })
  })

  it('throws on a policy assertion word it cannot check', () => {
    expect(() => block('-- policy: p ON s.t PROBABLY')).toThrow(/PROBABLY/)
  })

  it('leaves genuine prose on a policy as prose', () => {
    // Only the two words it can check are promoted; everything else stays a
    // note, or every explanatory comment becomes a parse error.
    const d = block('-- policy: p ON s.t  -- mirrors sup_select (00051) exactly')
    expect(d![0]).toMatchObject({ kind: 'policy', assertion: null, comment: 'mirrors sup_select (00051) exactly' })
  })

  // ── identifier validation ────────────────────────────────────────────────

  it('rejects an identifier that is not an identifier', () => {
    // Builds to_regclass('public.t"; DROP TABLE x;') — a predicate that can
    // never be true, so the run fails for the wrong reason and hides whether
    // the migration actually applied.
    expect(() => block('-- table: public.t"; DROP TABLE x;')).toThrow(/not a bare identifier/)
    expect(() => block('-- column: public.t.c";DROP')).toThrow(/not a bare identifier/)
    expect(() => block('-- index: "x";DROP ON public.t')).toThrow(/not a bare identifier/)
    expect(() => block('-- policy: p ON public."t";DROP')).toThrow(/not a bare identifier/)
    // The policy NAME as well as its table — these are validated on separate
    // code paths, and a fixture that only exercises the table cannot tell.
    expect(() => block('-- policy: "p";DROP ON public.t')).toThrow(/not a bare identifier/)
  })

  it('still accepts every identifier the real migrations use', () => {
    expect(block('-- index: idx_supply_routes_revision ON cable_schedule.supply_routes')![0])
      .toMatchObject({ name: 'idx_supply_routes_revision' })
  })

  // ── one block per file ───────────────────────────────────────────────────

  it('throws on a second @verify block rather than silently parsing only the first', () => {
    const sql = [
      '-- @verify:begin', '-- table: public.a', '-- @verify:end',
      'CREATE TABLE public.a (id int);',
      '-- @verify:begin', '-- table: public.b', '-- @verify:end',
    ].join('\n')
    expect(() => parseVerifyBlock(sql)).toThrow(/second @verify:begin/)
  })

  it('does NOT let a wrapped note corrupt a structured payload', () => {
    // The mirror of the test above: a grant_absent target is one signature and
    // never wraps, so 00192's four prose lines must stay out of the target.
    const d = block(
      '-- grant_absent: anon EXECUTE ON cable_schedule.bind_route_segment_parent()',
      '--   (never by reading proacl — a NULL proacl looks empty but IS the grant)',
    )
    expect((d![0] as { target: string }).target).toBe('cable_schedule.bind_route_segment_parent()')
  })
})

// ---------------------------------------------------------------------------
// The real files. Renumbering is routine in this repo, so this globs rather
// than naming versions — and asserts it found some, because a sweep over zero
// files passes vacuously.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = new URL(
  '../../../../../apps/edge-functions/supabase/migrations/',
  import.meta.url,
)

describe('parseVerifyBlock — every shipped migration that carries a block', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ f, sql: readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8') }))
    .filter(({ sql }) => sql.includes('@verify:begin'))

  it('found the migrations that ship a block (a sweep over none proves nothing)', () => {
    expect(files.length).toBeGreaterThanOrEqual(2)
  })

  // Counted off the real files. Keyed by the descriptive half of the name, not
  // the version number, because renumbering is routine in this repo (00183 was
  // claimed by two sessions in one day) and a test that breaks on a renumber
  // gets deleted. A count is what makes a mis-parse visible: "parses into at
  // least one directive" stays green if all 66 of 00192's directives fold into
  // a single note.
  const EXPECTED: Record<string, number> = {
    resend_email_delivery_evidence: 18,
    revoke_anon_execute_security_definer: 19,
    email_sequence_send_status: 5,
    cable_schedule_supply_routes: 66,
  }

  it.each(Object.keys(EXPECTED))('%s parses into exactly the directives it carries', (slug) => {
    const hit = files.find(({ f }) => f.includes(slug))
    expect(hit, `no migration file matching "${slug}"`).toBeDefined()
    const d = parseVerifyBlock(hit!.sql)
    expect(d).not.toBeNull()
    expect(d!.length).toBe(EXPECTED[slug])
  })

  it('reads the six RESTRICTIVE policies out of the real cable-schedule migration', () => {
    // The inline RESTRICTIVE fixture above is a line I typed. This one is the
    // shipped file, which is the thing that actually has to parse.
    const hit = files.find(({ f }) => f.includes('cable_schedule_supply_routes'))
    expect(hit).toBeDefined()
    const policies = parseVerifyBlock(hit!.sql)!.filter((x) => x.kind === 'policy')
    expect(policies).toHaveLength(10)
    expect(
      policies.filter((p) => p.assertion === 'restrictive').map((p) => p.name),
    ).toEqual([
      'route_write_authz_insert', 'route_write_authz_update', 'route_write_authz_delete',
      'segment_write_authz_insert', 'segment_write_authz_update', 'segment_write_authz_delete',
    ])
  })

  // Structural, so it also covers migrations added after this was written.
  // A folded or truncated payload shows up as whitespace or a comment marker
  // inside something that must be a bare identifier.
  it.each(files.map(({ f }) => f))('%s parses no identifier containing whitespace or a comment marker', (f) => {
    const d = parseVerifyBlock(files.find((x) => x.f === f)!.sql)!
    for (const x of d) {
      const rec = x as unknown as Record<string, unknown>
      for (const field of ['schema', 'table', 'column', 'name', 'jobname']) {
        const v = rec[field]
        if (typeof v !== 'string') continue
        expect(v, `${f}: ${x.kind}.${field}`).not.toMatch(/\s|--/)
      }
      // A grant target is a signature and may hold commas; it must still never
      // have swallowed a note.
      if (typeof rec.target === 'string') expect(rec.target, `${f}: target`).not.toMatch(/--|;/)
      if (Array.isArray(rec.schemas)) {
        for (const s of rec.schemas as string[]) expect(s, `${f}: schemas`).not.toMatch(/\s|--/)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Predicate building and evaluation.
// ---------------------------------------------------------------------------

// Omit<> does NOT distribute over a union — keyof (A|B|C) is the INTERSECTION
// of their keys, so Omit<VerifyDirective,'line'|'raw'> collapses to { kind }
// and every call site below trips excess-property checking. Distribute it.
type Bare<T> = T extends unknown ? Omit<T, 'line' | 'raw'> : never
const at = (d: Bare<VerifyDirective>): VerifyDirective =>
  ({ ...d, line: 1, raw: '-- x' }) as VerifyDirective

describe('buildPredicate', () => {
  it('checks a table through to_regclass, not information_schema.tables', () => {
    const p = buildPredicate(at({ kind: 'table', schema: 'public', name: 'product_events' }))
    expect(p).toContain("to_regclass('public.product_events')")
    expect(p).toMatch(/^SELECT .* AS ok$/s)
  })

  it('distinguishes a view from a table', () => {
    const p = buildPredicate(at({ kind: 'view', schema: 'public', name: 'metric_accounts' }))
    expect(p).toContain("relkind IN ('v','m')")
  })

  // pg_get_function_identity_arguments returns NAMED args with comma-SPACE
  // ("p_project_id uuid, p_user_id uuid"), so string-comparing it to the
  // directive text is false for every multi-arg function. to_regprocedure
  // parses by type name and is the only form that works.
  it('checks a MULTI-argument function by parsed signature, never by identity-argument text', () => {
    const p = buildPredicate(at({
      kind: 'function', schema: 'public', name: 'emit_product_event',
      args: 'uuid,uuid,text,jsonb,uuid,uuid',
    }))
    expect(p).toContain('to_regprocedure')
    expect(p).toContain("'public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)'")
    expect(p).not.toContain('pg_get_function_identity_arguments')
  })

  it('checks a zero-argument overload by its empty signature', () => {
    const p = buildPredicate(at({ kind: 'function', schema: 'public', name: 'user_is_org_admin', args: '' }))
    expect(p).toContain("to_regprocedure('public.user_is_org_admin()')")
  })

  it('grant_absent asserts the privilege is GONE, so a surviving grant fails', () => {
    const p = buildPredicate(at({ kind: 'grant_absent', role: 'anon', privilege: 'SELECT', target: 'public.product_events' }))
    expect(p).toContain('NOT has_table_privilege')
    expect(p).toContain("'anon'")
  })

  it('grant_absent on a function uses has_function_privilege, never proacl', () => {
    const p = buildPredicate(at({ kind: 'grant_absent', role: 'anon', privilege: 'EXECUTE', target: 'public.touch_presence(text,text)' }))
    expect(p).toContain('NOT has_function_privilege')
    expect(p).not.toContain('proacl')
  })

  it('wraps a raw sql directive so it always yields a single ok column', () => {
    const p = buildPredicate(at({ kind: 'sql', predicate: 'SELECT count(*) >= 8 FROM projects.calendar_years' }))
    expect(p).toContain('AS ok')
    expect(p).toContain('projects.calendar_years')
  })

  // ── the production kinds the plan's grammar does not list ────────────────

  it('grant_present asserts the privilege is THERE — the mirror of grant_absent', () => {
    const t = buildPredicate(at({ kind: 'grant_present', role: 'authenticated', privilege: 'SELECT', target: 'cable_schedule.supply_routes' }))
    expect(t).toContain('has_table_privilege')
    expect(t).not.toContain('NOT has_table_privilege')
    const f = buildPredicate(at({ kind: 'grant_present', role: 'authenticated', privilege: 'EXECUTE', target: 'cable_schedule.user_can_edit_schedule(uuid)' }))
    expect(f).toContain('has_function_privilege')
    expect(f).not.toContain('NOT has_function_privilege')
  })

  it('a plain column directive checks existence only', () => {
    const p = buildPredicate(at({
      kind: 'column', schema: 'projects', table: 'project_settings', column: 'working_days', assertion: null,
    }))
    expect(p).toContain("'working_days'")
    expect(p).not.toContain('attgenerated')
  })

  it('a GENERATED ALWAYS STORED column is checked as generated, not merely present', () => {
    // 00192's total_length_m exists either way; only attgenerated distinguishes
    // the generated column the migration promised from a plain numeric one.
    const p = buildPredicate(at({
      kind: 'column', schema: 'cable_schedule', table: 'supply_routes', column: 'total_length_m',
      assertion: 'generated_always_stored',
    }))
    expect(p).toContain("attgenerated = 's'")
  })

  it('anon_execute_absent sweeps EVERY named schema for prosecdef functions', () => {
    const schemas = ['public', 'projects', 'inspections', 'field', 'gcr']
    const p = buildPredicate(at({ kind: 'anon_execute_absent', schemas }))
    expect(p).toContain('prosecdef')
    expect(p).toContain('NOT EXISTS')
    expect(p).toContain('has_function_privilege')
    expect(p).not.toContain('proacl')
    for (const s of schemas) expect(p).toContain(`'${s}'`)
  })

  it('a RESTRICTIVE policy assertion is checked against pg_policies.permissive', () => {
    const p = buildPredicate(at({
      kind: 'policy', name: 'route_write_authz_insert', schema: 'cable_schedule',
      table: 'supply_routes', assertion: 'restrictive',
    }))
    expect(p).toContain("permissive = 'RESTRICTIVE'")
  })

  it('a PERMISSIVE assertion is checked too, and an unasserted policy is not', () => {
    const perm = buildPredicate(at({
      kind: 'policy', name: 'p', schema: 's', table: 't', assertion: 'permissive',
    }))
    expect(perm).toContain("permissive = 'PERMISSIVE'")
    const plain = buildPredicate(at({
      kind: 'policy', name: 'p', schema: 's', table: 't', assertion: null,
    }))
    expect(plain).not.toContain('permissive')
  })

  it('has no predicate for a behaviour directive — prose is not a check', () => {
    expect(buildPredicate(at({ kind: 'behaviour', description: 'contractor INSERT -> denied' }))).toBeNull()
  })
})

describe('runDirectives', () => {
  const one = at({ kind: 'table', schema: 'public', name: 'product_events' })
  const twoArgFn = at({
    kind: 'function', schema: 'public', name: 'touch_presence', args: 'text,text',
  })

  it('passes when the predicate returns true', async () => {
    const r = await runDirectives([one], async () => [{ ok: true }])
    expect(r.failures).toEqual([])
    expect(r.passed).toBe(1)
  })

  // The whole point of the tool. A check that cannot fail is decorative.
  it('FAILS when the predicate returns false', async () => {
    const r = await runDirectives([one], async () => [{ ok: false }])
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].reason).toMatch(/returned false/)
    expect(r.failures[0].directive.raw).toBe('-- x')
  })

  // The regression this task exists for: a TWO-argument function directive
  // must be able to go red. Under the old identity-argument comparison this
  // predicate was false against a function that really existed.
  it('FAILS a two-argument function directive when the database says the signature is absent', async () => {
    const r = await runDirectives([twoArgFn], async (s) => [
      { ok: !s.includes("'public.touch_presence(text,text)'") },
    ])
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].directive.raw).toBe('-- x')
  })

  it('PASSES a two-argument function directive when the database says it is present', async () => {
    const r = await runDirectives([twoArgFn], async (s) => [
      { ok: s.includes("'public.touch_presence(text,text)'") },
    ])
    expect(r.failures).toEqual([])
    expect(r.passed).toBe(1)
  })

  it('FAILS when the predicate returns no rows at all', async () => {
    const r = await runDirectives([one], async () => [])
    expect(r.failures[0].reason).toMatch(/no rows/)
  })

  it('FAILS when the query itself errors, rather than treating the error as absence', async () => {
    const r = await runDirectives([one], async () => { throw new Error('permission denied') })
    expect(r.failures[0].reason).toMatch(/permission denied/)
  })

  it('reports every failure, not only the first', async () => {
    const r = await runDirectives([one, one, one], async () => [{ ok: false }])
    expect(r.failures).toHaveLength(3)
  })

  it('does not run — and never counts as passed — a behaviour directive', async () => {
    const prose = at({ kind: 'behaviour', description: 'owner INSERT on a DRAFT revision -> allowed' })
    let calls = 0
    const r = await runDirectives([one, prose], async () => { calls += 1; return [{ ok: true }] })
    expect(calls).toBe(1)
    expect(r.passed).toBe(1)
    expect(r.failures).toEqual([])
    expect(r.skipped).toEqual([prose])
  })

  it('reads the column NAMED ok, not whichever column comes first', async () => {
    // The discriminating fixture: `ok` is true but is NOT the first column, and
    // the first column is not a boolean. Reading by position gives 1, which is
    // not === true, so a position-reading evaluator fails a directive the
    // database said was fine. Reading by name passes it.
    const good = await runDirectives([one], async () => [{ id: 1, ok: true }])
    expect(good.failures).toEqual([])
    expect(good.passed).toBe(1)
    // And the mirror, so the test cannot pass by always-failing either.
    const bad = await runDirectives([one], async () => [{ id: 1, ok: false }])
    expect(bad.passed).toBe(0)
    expect(bad.failures).toHaveLength(1)
  })

  // A NULL from Postgres is not a true. to_regclass on an absent schema, and a
  // COALESCE that was never added, both arrive here as null.
  it('FAILS on a null ok, rather than reading it as absence-is-fine', async () => {
    const r = await runDirectives([one], async () => [{ ok: null }])
    expect(r.failures).toHaveLength(1)
    expect(r.passed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The absent-object fixture the CLI proof runs against.
//
// It lives under packages/shared, NOT under the real migrations folder, so
// `supabase db push` and the migration-hygiene scanner never see it: on a
// shared checkout a stray .sql in that folder whose number collides with a real
// migration is precisely the numbering race this programme exists to prevent.
//
// This is the fixture-rule question answered out loud — what would it have to
// look like for the assertion to be able to fail? It names an object that does
// not and will not exist, so a run over it MUST go red. If it ever goes green,
// the tool is broken, not the database.
// ---------------------------------------------------------------------------

const ABSENT_OBJECT_FIXTURE = new URL(
  './__fixtures__/00999_fixture_absent_object.sql',
  import.meta.url,
)

describe('the absent-object fixture', () => {
  it('parses, and its single directive fails against a database that answers honestly', async () => {
    const sql = readFileSync(ABSENT_OBJECT_FIXTURE, 'utf8')
    const directives = parseVerifyBlock(sql)
    expect(directives).not.toBeNull()
    expect(directives!).toHaveLength(1)
    expect(directives![0].line).toBe(5)

    // Stub the database the way a real one would answer for an absent table.
    const r = await runDirectives(directives!, async (s) => [
      { ok: !s.includes('this_table_does_not_exist_and_never_will') },
    ])
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].directive.raw).toContain('this_table_does_not_exist_and_never_will')
  })
})
