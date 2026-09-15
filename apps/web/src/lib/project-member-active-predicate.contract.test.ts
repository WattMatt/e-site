import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Contract: `projects.project_members.is_active = false` REVOKES access at the
 * database, not only in the application.
 *
 * Two SQL helpers encode "does this user have this project", and they must
 * not drift apart:
 *
 *   - public.user_has_project_access(uuid)          (00106) — the predicate
 *     behind 93 RLS policies on 63 tables and three SECURITY DEFINER helpers
 *     (measured on production 2026-09-12).
 *   - public.user_effective_project_role(uuid, uuid) (00107) — the predicate
 *     behind every requireEffectiveRole() page/action gate.
 *
 * 00107 required `pm.is_active`; 00106 did not. A soft-deactivated member
 * therefore kept every database read while the app reported no role — and any
 * `COALESCE(user_effective_project_role(...), '') <> 'client_viewer'` predicate
 * read that NULL role as "not a client viewer", WIDENING a deactivated client
 * viewer to the whole project. Migration 00197 adds the predicate to clause
 * (a) of user_has_project_access.
 *
 * This test reads the migrations, resolves the FINAL definition of each helper
 * (a later CREATE OR REPLACE wins) and asserts the predicate actually in
 * force. A unit test on calling code cannot catch this: the defect lives
 * entirely in SQL. It was run red against the pre-00197 tree (00106's body is
 * the final definition there and carries no `pm.is_active`) before going
 * green, so it is a check that has been seen to fail.
 */
const REPO_ROOT = resolve(__dirname, '../../../..')
const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

/**
 * Blank out SQL comments so commentary can neither satisfy nor break an
 * assertion (00106's own header PROSE mentions is_active, and 00164 carries a
 * comment that names `pm.is_active` while deliberately omitting it). Block
 * comments are replaced newline-for-newline so line arithmetic, if anyone
 * adds it later, stays honest.
 */
function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}

interface FunctionDefinition {
  file: string
  /** Everything from CREATE up to the opening dollar-quote tag. */
  header: string
  /** The dollar-quoted body, tags excluded. */
  body: string
}

/**
 * The last `CREATE [OR REPLACE] FUNCTION <qualified>(` across the migration
 * directory in file order, with its dollar-quoted body sliced out. Function
 * bodies contain semicolons, so slicing to the next `;` (what the policy
 * contract tests do) would truncate them — the dollar-quote tag is the only
 * safe delimiter.
 */
function finalFunctionDefinition(qualified: string): FunctionDefinition | null {
  const escaped = qualified.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const create = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${escaped}\\s*\\(`, 'gi')
  let found: FunctionDefinition | null = null
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8'))
    for (const m of sql.matchAll(create)) {
      const tail = sql.slice(m.index)
      const tag = tail.match(/\bAS\s+(\$[A-Za-z_]*\$)/i)
      if (!tag || tag.index === undefined) {
        throw new Error(`${file}: ${qualified} has no dollar-quoted body`)
      }
      const open = tag.index + tag[0].length
      const close = tail.indexOf(tag[1], open)
      if (close === -1) throw new Error(`${file}: ${qualified} body has no closing ${tag[1]}`)
      found = { file, header: tail.slice(0, tag.index), body: tail.slice(open, close) }
    }
  }
  return found
}

/**
 * Clause (a) of user_has_project_access: the EXISTS over
 * `projects.project_members pm`, taken from that FROM up to the next EXISTS
 * (clause (b)) or the end of the body. Scoping the assertion to the clause
 * means a `pm.is_active` written somewhere irrelevant cannot satisfy it.
 */
function clauseA(body: string): string {
  const from = body.search(/FROM\s+projects\.project_members\s+pm\b/i)
  if (from === -1) throw new Error('user_has_project_access no longer reads projects.project_members')
  const rest = body.slice(from)
  const next = rest.slice(1).search(/\bEXISTS\s*\(/i)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

const REQUIRES_PM_ACTIVE = /\bpm\.is_active\b/i
const INVERTS_PM_ACTIVE = /\bNOT\s+pm\.is_active\b/i

describe('project_members.is_active revokes access at the database', () => {
  const access = finalFunctionDefinition('public.user_has_project_access')
  const role = finalFunctionDefinition('public.user_effective_project_role')

  it('both helpers have a final definition in the migrations', () => {
    expect(access, 'public.user_has_project_access is never defined').not.toBeNull()
    expect(role, 'public.user_effective_project_role is never defined').not.toBeNull()
  })

  it('user_has_project_access clause (a) requires pm.is_active (the 00197 fix)', () => {
    const a = clauseA(access!.body)
    expect(
      REQUIRES_PM_ACTIVE.test(a),
      `${access!.file}: clause (a) joins projects.project_members without pm.is_active — ` +
        'a soft-deactivated member keeps every RLS read gated on this helper',
    ).toBe(true)
    expect(INVERTS_PM_ACTIVE.test(a), `${access!.file}: clause (a) inverts pm.is_active`).toBe(false)
  })

  it('user_has_project_access clause (a) still requires uo.is_active (the org flag, 00106)', () => {
    // The org-level flag is the revocation path production actually uses today
    // (removeSubOrgMember flips user_organisations.is_active). Pinned so the
    // fix for one flag cannot regress the other.
    expect(/\buo\.is_active\b/i.test(clauseA(access!.body)), `${access!.file}: clause (a) lost uo.is_active`).toBe(true)
  })

  it('user_effective_project_role requires pm.is_active (00107) — the two helpers agree', () => {
    expect(
      REQUIRES_PM_ACTIVE.test(role!.body),
      `${role!.file}: user_effective_project_role no longer requires pm.is_active`,
    ).toBe(true)
    expect(INVERTS_PM_ACTIVE.test(role!.body)).toBe(false)
  })

  it('user_has_project_access keeps SECURITY DEFINER, STABLE and row_security off', () => {
    // The helper reads project_members and user_organisations from inside
    // policies ON those tables; without these attributes it either recurses
    // into RLS or stops being callable from a policy at all. A CREATE OR
    // REPLACE that drops one of them would still satisfy every existence check.
    const h = access!.header
    expect(/\bSECURITY\s+DEFINER\b/i.test(h), `${access!.file}: not SECURITY DEFINER`).toBe(true)
    expect(/\bSTABLE\b/i.test(h), `${access!.file}: not STABLE`).toBe(true)
    expect(/row_security\s+(?:TO|=)\s+'?off'?/i.test(h), `${access!.file}: row_security is not off`).toBe(true)
  })
})
