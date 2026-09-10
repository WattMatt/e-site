/**
 * CONTRACT — no SECURITY DEFINER function in a PostgREST-exposed schema may be
 * EXECUTE-able by `anon`.
 *
 * WHY THIS EXISTS. `public.project_notification_recipients(uuid,uuid)` (00146)
 * is SECURITY DEFINER with `row_security = off`. An unauthenticated POST to
 * `/rest/v1/rpc/project_notification_recipients` carrying only the public anon
 * key — which ships in the browser bundle — and a real project UUID returned
 * HTTP 200 and 2,040 bytes of `user_id, email, full_name` for KINGSWALK. A
 * nonexistent UUID returned 2 bytes, so it was not even a boolean oracle: it
 * was the roster. Thirty-two such functions were anon-executable in production
 * when this test was written. Migration 00186 revokes every one of them.
 *
 * WHY THE OBVIOUS TEST WOULD NOT WORK. Grepping migrations for the string
 * "REVOKE" is decorative: a `REVOKE ... FROM PUBLIC` does NOT remove anon's
 * EXECUTE in the `public` schema, because Supabase ships
 * `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO
 * anon, authenticated, service_role`, which grants anon DIRECTLY at creation —
 * a second, independent ACL entry. `00164_powersync_jwt_project_access.sql:68`
 * does exactly that revoke and `custom_jwt_claims` was still anon-executable in
 * production. So this test does not grep. It REPLAYS the migration corpus
 * through a model of Postgres function privilege, tracking the PUBLIC bit and
 * the anon bit separately, and asserts the anon-reachable state at the end.
 *
 * WHY THE MODEL IS TRUSTWORTHY. Its two seeding rules are read out of
 * production `pg_default_acl`, not guessed:
 *
 *   1. Every newly created function is EXECUTE-able by PUBLIC. That is the
 *      Postgres built-in default and `ALTER DEFAULT PRIVILEGES ... GRANT` only
 *      ADDS entries, it never displaces it. In production this shows up as the
 *      empty-grantee `=X/postgres` ACL item (e.g. `inspections.user_can_verify`).
 *   2. A function created in `public` ALSO gets a DIRECT anon grant. `public`
 *      is the only exposed schema with an `f`-type row in `pg_default_acl`
 *      naming anon; `projects`, `field`, `structure`, `cable_schedule`,
 *      `marketplace`, `billing`, `tenants`, `suppliers` and `gcr` have no
 *      function default ACL at all, and `inspections` has one that names only
 *      authenticated and service_role (00069). In production this shows up as
 *      the `anon=X/postgres` ACL item.
 *
 * `it('the privilege model reproduces production exactly')` pins the model
 * against a snapshot of `has_function_privilege('anon', oid, 'EXECUTE')` taken
 * from production on 2026-09-10, BEFORE 00186. If the model drifts from
 * Postgres, that test fails and this whole file is known to be lying.
 *
 * NEVER read `proacl` to decide this question. A NULL `proacl` looks empty but
 * IS the PUBLIC grant (see `cable_schedule.enforce_revision_lifecycle`).
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')

/**
 * The production PostgREST `db_schema` list, verbatim, read from
 * GET /v1/projects/cbskbnvvgcybmfikxgky/postgrest on 2026-09-10. Every schema
 * here is reachable over `/rest/v1/rpc/<fn>` with nothing but the anon key.
 */
const EXPOSED_SCHEMAS = [
  'public', 'projects', 'inspections', 'field', 'tenants', 'suppliers',
  'billing', 'marketplace', 'cable_schedule', 'structure', 'gcr',
] as const

/** Migration head in production when PRODUCTION_ANON_EXECUTABLE_BEFORE_00186 was captured. */
const PRODUCTION_HEAD_AT_SNAPSHOT = '00185'

/** Schemas created by a migration that PostgREST does NOT serve. */
const UNEXPOSED_SCHEMAS = ['compliance'] as const

/**
 * Functions permitted to remain anon-EXECUTE-able. Adding an entry here is a
 * deliberate decision to expose an unauthenticated RPC and must carry a reason.
 * The list is empty: this application has no anonymous data surface at all —
 * production holds exactly six RLS policies naming `anon`, all of them the
 * RESTRICTIVE write-authz policies from 00177, and not one anon SELECT policy.
 */
const ANON_EXECUTE_ALLOWLIST: ReadonlyArray<{ fn: string; reason: string }> = []

// ---------------------------------------------------------------------------
// SQL lexer — strips comments and dollar-quoted bodies, then splits statements.
// A function body may legally contain the words GRANT, REVOKE and even
// "SECURITY DEFINER"; replacing bodies with a placeholder is what stops those
// from being parsed as privilege statements.
// ---------------------------------------------------------------------------
export function splitStatements(sql: string): string[] {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl
      continue
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") { j += 1; break }
        j += 1
      }
      out += ' '
      i = j
      continue
    }
    const dollar = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))
    if (dollar) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, i + tag.length)
      i = end === -1 ? sql.length : end + tag.length
      out += ' __BODY__ '
      continue
    }
    out += sql[i]
    i += 1
  }
  return out.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const QUALIFIED = String.raw`([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)`

function parseRoles(list: string): string[] {
  return list
    .split(',')
    .map((r) => r.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean)
}

interface FnState {
  schema: string
  name: string
  securityDefiner: boolean
  publicExecute: boolean
  anonExecute: boolean
  createdIn: string
}

/** Replays the migration corpus and returns the final privilege state. */
export function replayMigrations(files: Array<{ name: string; sql: string }>): Map<string, FnState> {
  const state = new Map<string, FnState>()

  for (const file of files) {
    for (const stmt of splitStatements(file.sql)) {
      const upper = stmt.toUpperCase()

      const create = new RegExp(
        String.raw`^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+${QUALIFIED}\s*\(`, 'i',
      ).exec(stmt)
      if (create) {
        const schema = create[2].toLowerCase()
        const name = create[3].toLowerCase()
        const key = `${schema}.${name}`
        // SECURITY INVOKER is the default; only an explicit DEFINER counts.
        const securityDefiner = /\bSECURITY\s+DEFINER\b/i.test(stmt)
        const existing = state.get(key)
        if (existing) {
          // CREATE OR REPLACE does NOT reset an existing function's ACL.
          existing.securityDefiner = securityDefiner
        } else {
          state.set(key, {
            schema, name, securityDefiner,
            publicExecute: true,                 // seeding rule 1
            anonExecute: schema === 'public',    // seeding rule 2
            createdIn: file.name,
          })
        }
        continue
      }

      const drop = new RegExp(
        String.raw`^DROP\s+FUNCTION\s+(IF\s+EXISTS\s+)?${QUALIFIED}`, 'i',
      ).exec(stmt)
      if (drop) {
        state.delete(`${drop[2].toLowerCase()}.${drop[3].toLowerCase()}`)
        continue
      }

      const isGrant = upper.startsWith('GRANT ')
      const isRevoke = upper.startsWith('REVOKE ')
      if (!isGrant && !isRevoke) continue
      if (!/\bON\s+(ALL\s+FUNCTIONS\s+IN\s+SCHEMA|FUNCTION)\b/i.test(stmt)) continue
      if (!/\b(EXECUTE|ALL)\b/i.test(stmt.slice(0, stmt.search(/\bON\b/i)))) continue

      const roleList = isGrant
        ? /\bTO\s+(.+)$/i.exec(stmt)?.[1]
        : /\bFROM\s+(.+)$/i.exec(stmt)?.[1]
      if (!roleList) continue
      const roles = parseRoles(roleList.replace(/\b(CASCADE|RESTRICT)\b/i, ''))
      const touchesPublic = roles.includes('public')
      const touchesAnon = roles.includes('anon')
      if (!touchesPublic && !touchesAnon) continue

      const applyTo = (fn: FnState) => {
        if (touchesPublic) fn.publicExecute = isGrant
        if (touchesAnon) fn.anonExecute = isGrant
      }

      const schemaWide = new RegExp(
        String.raw`\bON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+([A-Za-z_][A-Za-z0-9_]*)`, 'i',
      ).exec(stmt)
      if (schemaWide) {
        const schema = schemaWide[1].toLowerCase()
        for (const fn of state.values()) if (fn.schema === schema) applyTo(fn)
        continue
      }

      const target = new RegExp(String.raw`\bON\s+FUNCTION\s+${QUALIFIED}`, 'i').exec(stmt)
      if (!target) continue
      const fn = state.get(`${target[1].toLowerCase()}.${target[2].toLowerCase()}`)
      if (fn) applyTo(fn)
    }
  }
  return state
}

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

const FINAL_STATE = replayMigrations(loadMigrations())

function anonReachable(fn: FnState): boolean {
  return fn.publicExecute || fn.anonExecute
}

describe('anon EXECUTE on SECURITY DEFINER functions', () => {
  it('parses a meaningful number of functions out of the corpus', () => {
    // Guards the fixture rule: a parser that silently matched nothing would
    // make every assertion below vacuously true.
    expect(FINAL_STATE.size).toBeGreaterThan(60)
    expect([...FINAL_STATE.values()].filter((f) => f.securityDefiner).length).toBeGreaterThan(30)
  })

  it('the privilege model reproduces production exactly', () => {
    // Snapshot of has_function_privilege('anon', oid, 'EXECUTE') for every
    // prosecdef function in every exposed schema, taken from production
    // 2026-09-10 BEFORE migration 00186. Replaying the corpus WITHOUT 00186
    // must reproduce it; with 00186 present, every `true` below becomes false,
    // which is the whole point of the migration. So the model is pinned by
    // recomputing the pre-00186 state.
    // Replay only what production had actually applied when the snapshot was
    // taken: head was 00185. Scoping by head — rather than by "everything
    // except 00186" — keeps this a stable pin, so a migration added next month
    // trips the contract test below and not this one.
    const preFix = replayMigrations(
      loadMigrations().filter((f) => f.name.slice(0, 5) <= PRODUCTION_HEAD_AT_SNAPSHOT),
    )
    const modelled = [...preFix.values()]
      .filter((f) => f.securityDefiner && (EXPOSED_SCHEMAS as readonly string[]).includes(f.schema))
      .filter((f) => anonReachable(f))
      .map((f) => `${f.schema}.${f.name}`)
      .sort()

    expect(modelled).toEqual(PRODUCTION_ANON_EXECUTABLE_BEFORE_00186)
  })

  it('every schema a migration creates is classified as exposed or not', () => {
    const created = new Set<string>()
    for (const { sql } of loadMigrations()) {
      for (const m of sql.matchAll(/CREATE\s+SCHEMA\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        created.add(m[2].toLowerCase())
      }
    }
    const known = new Set<string>([...EXPOSED_SCHEMAS, ...UNEXPOSED_SCHEMAS])
    const unclassified = [...created].filter((s) => !known.has(s)).sort()
    expect(unclassified, 'new schema: add it to EXPOSED_SCHEMAS or UNEXPOSED_SCHEMAS').toEqual([])
  })

  it('no SECURITY DEFINER function in an exposed schema is anon-EXECUTE-able', () => {
    const allowed = new Set(ANON_EXECUTE_ALLOWLIST.map((a) => a.fn))
    const offenders = [...FINAL_STATE.values()]
      .filter((f) => f.securityDefiner)
      .filter((f) => (EXPOSED_SCHEMAS as readonly string[]).includes(f.schema))
      .filter((f) => anonReachable(f))
      .map((f) => `${f.schema}.${f.name} (created ${f.createdIn}${f.publicExecute ? ', PUBLIC' : ''}${f.anonExecute ? ', anon' : ''})`)
      .filter((label) => !allowed.has(label.split(' ')[0]))
      .sort()

    expect(
      offenders,
      'REVOKE ALL ON FUNCTION <fn> FROM PUBLIC, anon — naming anon explicitly, ' +
      'because Supabase grants anon directly at creation in the public schema ' +
      'and a bare REVOKE FROM PUBLIC leaves it in place.',
    ).toEqual([])
  })

  it('the allow-list carries a reason for every entry', () => {
    for (const entry of ANON_EXECUTE_ALLOWLIST) {
      expect(entry.reason.length, `${entry.fn} needs a reason`).toBeGreaterThan(20)
    }
  })
})

/**
 * Production truth, 2026-09-10, before 00186. Produced by:
 *
 *   SELECT n.nspname||'.'||p.proname
 *   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 *   WHERE n.nspname = ANY(<db_schema list>) AND p.prosecdef
 *     AND has_function_privilege('anon', p.oid, 'EXECUTE')
 *   ORDER BY 1;
 */
const PRODUCTION_ANON_EXECUTABLE_BEFORE_00186 = [
  'cable_schedule.enforce_cable_child_frozen',
  'cable_schedule.enforce_revision_data_frozen',
  'cable_schedule.enforce_revision_lifecycle',
  'field.snag_visits_ensure_no',
  'inspections.allocate_coc_number',
  'inspections.is_inspection_verifier',
  'inspections.user_can_verify',
  'inspections.user_can_write_responses',
  'inspections.user_has_inspection_read',
  'marketplace.refresh_supplier_rating_summary',
  'projects.jbcc_allocate_letter_reference',
  'projects.project_settings_audit',
  'projects.qc_report_children_frozen',
  'projects.qc_reports_ensure_no',
  'projects.qc_reports_status_guard',
  'projects.valuations_set_no',
  'projects.variation_orders_set_no',
  'public.custom_jwt_claims',
  'public.floor_plan_project_id',
  'public.get_user_org_ids_bypass',
  'public.handle_new_user',
  'public.has_feature',
  'public.has_feature_seat',
  'public.project_notification_recipients',
  'public.user_can_manage_project',
  'public.user_can_manage_project_members',
  'public.user_has_mv_access',
  'public.user_is_org_admin',
  'structure.node_order_project_id',
  'structure.recompute_tenant_doc_status',
  'structure.tenant_doc_delete_status_trg',
  'structure.tenant_doc_revision_status_trg',
]
