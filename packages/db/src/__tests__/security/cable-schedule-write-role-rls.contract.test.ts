/**
 * CONTRACT — no table in `cable_schedule` may accept writes from a role the
 * application would refuse.
 *
 * WHY THIS EXISTS. Every cable-schedule server action gates writes on
 * ORG_WRITE_ROLES (owner / admin / project_manager) via
 * `requireRoleForRevision(…, ROLES_ENGINEER)`, and `ROLE_CAPS` maps every
 * other org role to `Viewer` with no capability at all. The 00051 table
 * policies asked a different and much weaker question —
 *
 *     organisation_id = ANY(get_user_org_ids())
 *     AND NOT user_is_client_viewer(organisation_id)
 *
 * — which is a membership test, not an authorisation test. `cable_schedule`
 * is PostgREST-exposed and `authenticated` holds INSERT/UPDATE/DELETE on these
 * tables, so until migration 00193 the `rbac-test` **contractor** could, over
 * raw REST against production (demonstrated in rolled-back transactions):
 * rewrite a measured length on the live KINGSWALK DRAFT, delete cables, wipe
 * all 13 cost lines and all 74 cable tags, forge and then delete 729
 * change-log rows, flip a DRAFT revision to ISSUED, and delete a revision —
 * which cascaded 6 cables and 6 supplies away, because referential-integrity
 * cascades are not subject to row security on the child table.
 *
 * WHAT THIS TEST CATCHES. Not a regression of 00193's own policies (a DROP
 * would be visible in review). The failure it is really here for is the NEXT
 * table: someone adds `cable_schedule.whatever` and copies the 00051 policy
 * shape, and the role gate is quietly absent again. Every table with a
 * permissive write policy must either carry a RESTRICTIVE INSERT/UPDATE/DELETE
 * gate or be named in DECLARED_GAPS with a reason — the "declare it or fail
 * the build" shape that `report-kind-access.contract.test.ts` uses.
 *
 * WHY IT DOES NOT READ THE DATABASE. Same reason as
 * `anon-execute-secdef.test.ts`: CI has no production credentials, so the
 * migration corpus IS the artefact under test. It is replayed in filename
 * order and the END state is asserted.
 *
 * PARSER LIMITATION, STATED SO IT IS NOT MISTAKEN FOR COVERAGE. Statements are
 * matched textually after comments are stripped, including inside `DO $$ … $$`
 * blocks (00063 creates `rate_library`'s policies that way, and a parser that
 * skipped dollar-quoted bodies would have reported that table as having no
 * policies at all — a silent false pass). A policy created through
 * `EXECUTE format(…)` with an interpolated name would still be invisible. No
 * migration does that today, and the corpus-size and rate_library assertions
 * below fail loudly if the parser ever starts matching nothing — the fixture
 * question asked directly: what would the input have to look like for these
 * assertions to be able to fail? See the `analyser can actually fail` block.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')
const SCHEMA = 'cable_schedule'

type Cmd = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
const WRITE_CMDS: Cmd[] = ['INSERT', 'UPDATE', 'DELETE']

interface Policy {
  table: string
  name: string
  restrictive: boolean
  cmd: Cmd
  /** TRUE when the predicate actually calls one of the role-gate helpers. */
  roleGate: boolean
  migration: string
}

/**
 * The only predicates that answer "may this caller EDIT a cable schedule".
 * A RESTRICTIVE policy that calls none of these is some other kind of gate —
 * `fault_results_require_mv_access` (00191) is RESTRICTIVE FOR ALL and gates
 * the paid MV entitlement, not the role. Counting it as a role gate would have
 * made this whole test report two ungated tables as safe.
 */
const ROLE_GATE_HELPERS =
  /\buser_can_edit_(schedule|revision|cable|project)\b/i

/**
 * Tables whose write policies are deliberately NOT backed by a RESTRICTIVE
 * role gate. Adding an entry is a decision to accept that any org member who
 * is not a `client_viewer` — contractor, inspector, supplier — can write the
 * table over PostgREST. It must carry a reason.
 */
const DECLARED_GAPS: ReadonlyArray<{ table: string; reason: string }> = [
  {
    table: 'rate_library',
    reason:
      '00063 already gates each write command on user_organisations.role IN (owner, admin, project_manager) inside the permissive policy itself — the same set 00193 enforces, expressed one layer up. No RESTRICTIVE overlay needed.',
  },
  {
    table: 'sans_overrides',
    reason:
      'Same 00051 shape, not fixed by 00193. Project-level SANS derate overrides; production holds 0 rows. Tracked in docs/rbac-matrix.md "Known gaps".',
  },
  {
    table: 'fault_sources',
    reason:
      'MV module (00191 family). Its RESTRICTIVE overlay, where present, gates the paid ENTITLEMENT (user_has_mv_access), not the role. Left for the MV hardening change.',
  },
  {
    table: 'fault_results',
    reason:
      'MV module — same 00051 write predicate as fault_sources. Its 00191 RESTRICTIVE overlay gates the paid entitlement, not the role.',
  },
  {
    table: 'protection_devices',
    reason:
      'MV module — same 00051 write predicate as fault_sources; no RESTRICTIVE overlay at all. Left for the MV hardening change.',
  },
  {
    table: 'discrimination_checks',
    reason:
      'MV module — same 00051 write predicate as fault_sources. Its 00191 RESTRICTIVE overlay gates the paid entitlement, not the role.',
  },
  {
    table: 'mv_study_settings',
    reason:
      'MV module — same 00051 write predicate as fault_sources; no RESTRICTIVE overlay at all. Left for the MV hardening change.',
  },
  {
    table: 'mv_study_signoff',
    reason:
      'MV module — same 00051 write predicate as fault_sources; no RESTRICTIVE overlay at all. Left for the MV hardening change.',
  },
]

const GAP_TABLES = new Set(DECLARED_GAPS.map((g) => g.table))

/** Tables 00193 gates. Pinned so a silent removal fails here, not in production. */
const GATED_BY_00193 = [
  'supplies',
  'cables',
  'sources',
  'cost_lines',
  'terminations',
  'cable_tags',
  'revisions',
  'change_log',
] as const

/** Gated by 00192, which shipped with the gate from the start. */
const GATED_BY_00192 = ['supply_routes', 'route_segments'] as const

/**
 * Gated by 00200. 00199 created route_history with the role test inside a
 * permissive INSERT policy keyed on the client-supplied organisation_id — the
 * 00051 shape this test exists to catch — and this test caught it on PR #190.
 */
const GATED_BY_00200 = ['route_history'] as const

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Blank out `--` line comments and block comments, preserving offsets so
 * statement order within a file is unchanged. String literals are left alone:
 * a policy name may legally contain `--`, and none in this corpus does.
 */
function stripComments(sql: string): string {
  let out = sql.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length))
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return out
}

const IDENT = String.raw`(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))`

interface Event {
  at: number
  kind: 'create-policy' | 'drop-policy' | 'create-table' | 'drop-table'
  table: string
  name?: string
  restrictive?: boolean
  cmd?: Cmd
  roleGate?: boolean
}

function parseMigration(name: string, rawSql: string): Event[] {
  const sql = stripComments(rawSql)
  const events: Event[] = []

  const createPolicy = new RegExp(
    String.raw`\bCREATE\s+POLICY\s+${IDENT}\s+ON\s+${SCHEMA}\.${IDENT}` +
      String.raw`((?:\s|\n)+AS\s+(RESTRICTIVE|PERMISSIVE))?` +
      String.raw`((?:\s|\n)+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE))?`,
    'gi',
  )
  for (let m = createPolicy.exec(sql); m; m = createPolicy.exec(sql)) {
    // The predicate runs from the match to the statement's semicolon. A policy
    // expression cannot contain one, so this is unambiguous.
    const end = sql.indexOf(';', m.index)
    const body = sql.slice(m.index, end === -1 ? sql.length : end)
    events.push({
      at: m.index,
      kind: 'create-policy',
      name: (m[1] ?? m[2]).toLowerCase(),
      table: (m[3] ?? m[4]).toLowerCase(),
      restrictive: (m[6] ?? '').toUpperCase() === 'RESTRICTIVE',
      // Postgres defaults an omitted FOR to ALL.
      cmd: ((m[8] ?? 'ALL').toUpperCase() as Cmd),
      roleGate: ROLE_GATE_HELPERS.test(body),
    })
  }

  const dropPolicy = new RegExp(
    String.raw`\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?${IDENT}\s+ON\s+${SCHEMA}\.${IDENT}`,
    'gi',
  )
  for (let m = dropPolicy.exec(sql); m; m = dropPolicy.exec(sql)) {
    events.push({
      at: m.index,
      kind: 'drop-policy',
      name: (m[1] ?? m[2]).toLowerCase(),
      table: (m[3] ?? m[4]).toLowerCase(),
    })
  }

  const createTable = new RegExp(
    String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${SCHEMA}\.${IDENT}`,
    'gi',
  )
  for (let m = createTable.exec(sql); m; m = createTable.exec(sql)) {
    events.push({ at: m.index, kind: 'create-table', table: (m[1] ?? m[2]).toLowerCase() })
  }

  const dropTable = new RegExp(
    String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${SCHEMA}\.${IDENT}`,
    'gi',
  )
  for (let m = dropTable.exec(sql); m; m = dropTable.exec(sql)) {
    events.push({ at: m.index, kind: 'drop-table', table: (m[1] ?? m[2]).toLowerCase() })
  }

  void name
  return events.sort((a, b) => a.at - b.at)
}

interface EndState {
  tables: Set<string>
  policies: Map<string, Policy>
}

export function replay(corpus: ReadonlyArray<{ name: string; sql: string }>): EndState {
  const tables = new Set<string>()
  const policies = new Map<string, Policy>()

  for (const { name, sql } of corpus) {
    for (const e of parseMigration(name, sql)) {
      const key = `${e.table}.${e.name}`
      switch (e.kind) {
        case 'create-table':
          tables.add(e.table)
          break
        case 'drop-table':
          tables.delete(e.table)
          for (const k of [...policies.keys()]) {
            if (policies.get(k)!.table === e.table) policies.delete(k)
          }
          break
        case 'create-policy':
          policies.set(key, {
            table: e.table,
            name: e.name!,
            restrictive: e.restrictive!,
            cmd: e.cmd!,
            roleGate: e.roleGate!,
            migration: name,
          })
          break
        case 'drop-policy':
          policies.delete(key)
          break
      }
    }
  }
  return { tables, policies }
}

/** Commands a policy covers. */
function covers(p: Policy, cmd: Cmd): boolean {
  return p.cmd === 'ALL' || p.cmd === cmd
}

/** Tables that accept a write from some role but have no RESTRICTIVE role gate. */
export function ungatedWriteTables(state: EndState): string[] {
  const bad: string[] = []
  for (const table of [...state.tables].sort()) {
    const forTable = [...state.policies.values()].filter((p) => p.table === table)
    const permissiveWrite = forTable.some(
      (p) => !p.restrictive && WRITE_CMDS.some((c) => covers(p, c)),
    )
    if (!permissiveWrite) continue
    const gated = WRITE_CMDS.every((c) =>
      forTable.some((p) => p.restrictive && p.roleGate && covers(p, c)),
    )
    if (!gated) bad.push(table)
  }
  return bad
}

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

const STATE = replay(loadMigrations())

// ---------------------------------------------------------------------------

describe('cable_schedule write-role RLS', () => {
  it('parses a meaningful corpus (guards against vacuous assertions)', () => {
    // A parser that matched nothing would make every assertion below pass.
    expect(STATE.tables.size).toBeGreaterThanOrEqual(15)
    expect(STATE.policies.size).toBeGreaterThanOrEqual(30)
  })

  it('sees inside DO blocks — rate_library policies are not invisible', () => {
    // 00063 creates these inside `DO $$ … $$`. If this ever returns 0, the
    // parser has started skipping dollar-quoted bodies and DECLARED_GAPS
    // entries would start passing for the wrong reason.
    const rl = [...STATE.policies.values()].filter((p) => p.table === 'rate_library')
    expect(rl.length).toBeGreaterThanOrEqual(4)
  })

  it('knows cable_schedule.boards was dropped', () => {
    // Supplies reference structure.nodes now. If this fails, the DROP TABLE
    // handling has broken and dead tables are being audited.
    expect(STATE.tables.has('boards')).toBe(false)
    expect(STATE.tables.has('supplies')).toBe(true)
  })

  it.each([...GATED_BY_00193, ...GATED_BY_00192, ...GATED_BY_00200])(
    '%s carries a RESTRICTIVE gate on INSERT, UPDATE and DELETE',
    (table) => {
      const forTable = [...STATE.policies.values()].filter((p) => p.table === table)
      for (const cmd of WRITE_CMDS) {
        const gate = forTable.find((p) => p.restrictive && p.roleGate && covers(p, cmd))
        expect(gate, `${table} has no RESTRICTIVE role-gated ${cmd} policy`).toBeDefined()
      }
    },
  )

  it('no RESTRICTIVE write gate is declared FOR ALL', () => {
    // A RESTRICTIVE FOR ALL also restricts SELECT, which would silently cut
    // off the project-scoped client_viewer read and the 00163 cross-org read.
    const forAll = [...STATE.policies.values()].filter(
      (p) => p.restrictive && p.cmd === 'ALL' && p.name.includes('write_authz'),
    )
    expect(forAll.map((p) => `${p.table}.${p.name}`)).toEqual([])
  })

  it('every table that accepts writes is gated or explicitly declared a gap', () => {
    const ungated = ungatedWriteTables(STATE)
    const undeclared = ungated.filter((t) => !GAP_TABLES.has(t))
    expect(
      undeclared,
      `cable_schedule tables accept writes with no RESTRICTIVE role gate and no DECLARED_GAPS entry: ${undeclared.join(', ')}. ` +
        'Add a RESTRICTIVE INSERT/UPDATE/DELETE policy calling cable_schedule.user_can_edit_revision / _cable / _project (see 00193), ' +
        'or declare the gap with a reason.',
    ).toEqual([])
  })

  it('DECLARED_GAPS contains no stale entry', () => {
    // A table that has since been gated must be removed from the list, or the
    // list stops meaning anything.
    const ungated = new Set(ungatedWriteTables(STATE))
    const stale = DECLARED_GAPS.filter((g) => STATE.tables.has(g.table) && !ungated.has(g.table))
    expect(stale.map((g) => g.table)).toEqual([])
  })

  it('every DECLARED_GAPS entry carries a reason', () => {
    for (const g of DECLARED_GAPS) expect(g.reason.length).toBeGreaterThan(40)
  })
})

describe('the analyser can actually fail', () => {
  // The fixture question: what would the corpus have to look like for these
  // assertions to fail? These synthetic corpora answer it directly.

  const PERMISSIVE_ONLY = `
    CREATE TABLE cable_schedule.widgets (id UUID PRIMARY KEY, revision_id UUID NOT NULL);
    CREATE POLICY "wid_write" ON cable_schedule.widgets FOR ALL
      USING (organisation_id = ANY(public.get_user_org_ids()));
  `

  const WITH_GATE = `${PERMISSIVE_ONLY}
    CREATE POLICY "wid_write_authz_insert" ON cable_schedule.widgets
      AS RESTRICTIVE FOR INSERT TO authenticated, anon
      WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));
    CREATE POLICY "wid_write_authz_update" ON cable_schedule.widgets
      AS RESTRICTIVE FOR UPDATE TO authenticated, anon
      USING (cable_schedule.user_can_edit_revision(revision_id))
      WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));
    CREATE POLICY "wid_write_authz_delete" ON cable_schedule.widgets
      AS RESTRICTIVE FOR DELETE TO authenticated, anon
      USING (cable_schedule.user_can_edit_revision(revision_id));
  `

  it('flags a 00051-shaped table with no RESTRICTIVE gate', () => {
    expect(ungatedWriteTables(replay([{ name: '99991_x.sql', sql: PERMISSIVE_ONLY }])))
      .toEqual(['widgets'])
  })

  it('clears the same table once the gate is added', () => {
    expect(ungatedWriteTables(replay([{ name: '99991_x.sql', sql: WITH_GATE }])))
      .toEqual([])
  })

  it('flags it again if one of the three commands is dropped later', () => {
    const dropped = `${WITH_GATE}
      DROP POLICY IF EXISTS "wid_write_authz_delete" ON cable_schedule.widgets;`
    expect(ungatedWriteTables(replay([{ name: '99991_x.sql', sql: dropped }])))
      .toEqual(['widgets'])
  })

  it('does not flag a table that only exposes SELECT', () => {
    const readOnly = `
      CREATE TABLE cable_schedule.lookup (id UUID PRIMARY KEY);
      CREATE POLICY "lk_read" ON cable_schedule.lookup FOR SELECT USING (true);`
    expect(ungatedWriteTables(replay([{ name: '99991_x.sql', sql: readOnly }]))).toEqual([])
  })

  it('does not flag a table that was dropped again', () => {
    const dropped = `${PERMISSIVE_ONLY}
      DROP TABLE IF EXISTS cable_schedule.widgets;`
    expect(ungatedWriteTables(replay([{ name: '99991_x.sql', sql: dropped }]))).toEqual([])
  })
})
