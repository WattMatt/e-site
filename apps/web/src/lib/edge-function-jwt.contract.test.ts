import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Contract: a function that authorises callers by DECODING a JWT role claim
 * must be deployed with gateway JWT verification enabled.
 *
 * `_shared/auth.ts::requireServiceRole` reads `role` out of the token payload
 * without checking a signature. That is sound only because the Supabase gateway
 * verifies the JWT first — and the gateway only does that when the function is
 * deployed WITHOUT `--no-verify-jwt`. The guard and the deploy flag are one
 * mechanism split across two files, and nothing connected them.
 *
 * On 2026-09-11 that gap was live on three deployed functions
 * (`send-notification`, `payment-recovery-check`, `calculate-health-scores`):
 * each accepted a self-made, unsigned `{"role":"service_role"}` token from an
 * unauthenticated caller. Proven non-destructively by sending a token whose
 * role was deliberately NOT service_role and getting the HANDLER's own 403
 * instead of the gateway's 401 — the handler replying at all is the proof that
 * nothing verified the signature.
 *
 * The flags were corrected in production, but a flag is not a fix: the deploy
 * workflow still carried `--no-verify-jwt`, so the next run would have silently
 * re-opened every one of them. This test is the part that survives a rerun.
 *
 * It deliberately DERIVES the guarded set by scanning imports rather than
 * reading the hand-maintained list in `_shared/auth.ts`. A hardcoded list is
 * exactly the fixture that cannot fail: a new function importing the helper
 * would be missed by a list nobody updated, which is the failure mode being
 * guarded against.
 */

const REPO_ROOT = resolve(__dirname, '../../../..')
const FUNCTIONS_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/functions')

/**
 * The canonical deploy commands. These functions are deployed BY HAND — the
 * GitHub workflow is manual-dispatch only and its secrets are unbound, so it
 * has never successfully run. The flags therefore live in a checked-in script
 * rather than in someone's shell history, and that script is what this asserts.
 */
const DEPLOY_SCRIPT = join(REPO_ROOT, 'apps/edge-functions/deploy.sh')

/**
 * The GitHub workflow deploys a SUBSET of the same functions with its own copy
 * of the flags, and that copy is how the hole survived being fixed: production
 * was corrected on 2026-09-11, but this file still said `--no-verify-jwt` for
 * `send-notification`, so the next dispatch would have re-opened it. Asserting
 * deploy.sh alone would leave the second copy unguarded.
 */
const DEPLOY_WORKFLOW = join(REPO_ROOT, '.github/workflows/deploy-edge-functions.yml')

/** Function slugs whose index.ts imports the decode-only service-role guard. */
function functionsWithDecodeOnlyGuard(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((name) => !name.startsWith('_'))
    .filter((name) => existsSync(join(FUNCTIONS_DIR, name, 'index.ts')))
    .filter((name) => {
      const src = readFileSync(join(FUNCTIONS_DIR, name, 'index.ts'), 'utf8')
      return /from\s+['"]\.\.\/_shared\/auth\.ts['"]/.test(src)
        && /requireServiceRole|getJwtRole/.test(src)
    })
    .sort()
}

/**
 * The `slug:flags` table in deploy.sh. An empty flags field means gateway JWT
 * verification is left ON.
 */
function deployTable(): Array<{ slug: string; flags: string }> {
  const sh = readFileSync(DEPLOY_SCRIPT, 'utf8')
  const table = sh.slice(sh.indexOf('FUNCTIONS=('), sh.indexOf('\n)', sh.indexOf('FUNCTIONS=(')))
  const out: Array<{ slug: string; flags: string }> = []
  for (const m of table.matchAll(/^\s*"([a-z0-9-]+):([^"]*)"/gm)) {
    out.push({ slug: m[1], flags: m[2] })
  }
  return out
}

/**
 * The `supabase functions deploy <slug> [flags]` commands in the workflow.
 * Parsed from the `run:` lines rather than from step names, because the step
 * name is a label nobody executes — a step named "Deploy send-email" that runs
 * a different slug would be invisible to a name-based scan.
 */
function workflowTable(): Array<{ slug: string; flags: string }> {
  const yml = readFileSync(DEPLOY_WORKFLOW, 'utf8')
  const out: Array<{ slug: string; flags: string }> = []
  for (const m of yml.matchAll(
    /^\s*run:\s*supabase\s+functions\s+deploy\s+([a-z0-9-]+)([^\n]*)$/gm,
  )) {
    out.push({ slug: m[1], flags: m[2].trim() })
  }
  return out
}

describe('edge functions: the deploy workflow agrees with deploy.sh', () => {
  it('finds deploy commands in the workflow at all (guards the parser itself)', () => {
    // Without this, a renamed file or a reformatted `run:` line would empty the
    // scan and every assertion below would pass while asserting nothing — the
    // same vacuous-fixture failure this suite exists to prevent.
    const cmds = workflowTable()
    expect(cmds.length).toBeGreaterThan(5)
    expect(cmds.map((c) => c.slug)).toContain('send-notification')
    expect(cmds.map((c) => c.slug)).toContain('send-email')
  })

  it('deploys no slug that deploy.sh does not list', () => {
    // The workflow carried a `generate-report` step for a function that exists
    // neither in this repository nor on the Supabase project. A step deploying
    // a slug the canonical script has never heard of is either a typo that
    // fails the run or a function nobody reviews.
    const known = new Set(deployTable().map((c) => c.slug))
    const unknown = workflowTable()
      .map((c) => c.slug)
      .filter((slug) => !known.has(slug))

    expect(
      unknown,
      `The deploy workflow deploys slugs that are absent from ` +
      `apps/edge-functions/deploy.sh: ${unknown.join(', ')}. deploy.sh is the ` +
      `source of truth for slugs — add them there, or drop the step.`,
    ).toEqual([])
  })

  it('uses exactly the flags deploy.sh uses for the same slug', () => {
    // This is the assertion that keeps the two copies of a SECURITY DECISION in
    // step. It subsumes the decode-only check above for the workflow: deploy.sh
    // is already asserted never to hand a decode-only-guarded function
    // `--no-verify-jwt`, so a workflow that matches it byte-for-byte cannot
    // either. It also catches the opposite mistake — adding the flag to
    // `send-email`, whose public path is NOT a reason to stop verifying
    // signatures (PR #176), and which production runs with verify_jwt=true.
    const canonical = new Map(deployTable().map((c) => [c.slug, c.flags.trim()]))
    const mismatched = workflowTable()
      .filter((c) => canonical.has(c.slug) && canonical.get(c.slug) !== c.flags)
      .map((c) => `${c.slug}: workflow "${c.flags}" vs deploy.sh "${canonical.get(c.slug)}"`)

    expect(
      mismatched,
      `The deploy workflow and apps/edge-functions/deploy.sh disagree on deploy ` +
      `flags: ${mismatched.join('; ')}. --no-verify-jwt disables gateway ` +
      `signature verification, so the two files disagreeing means one of them ` +
      `silently re-opens a hole the other closed. deploy.sh is the source of truth.`,
    ).toEqual([])
  })
})

describe('edge functions: decode-only auth requires a verifying gateway', () => {
  it('finds the guarded functions at all (guards the scanner itself)', () => {
    // If the scan silently matched nothing, every assertion below would pass
    // vacuously and this file would be decoration.
    const guarded = functionsWithDecodeOnlyGuard()
    expect(guarded.length).toBeGreaterThan(5)
    expect(guarded).toContain('send-notification')
    expect(guarded).toContain('eft-invoice')
  })

  it('never deploys a decode-only-guarded function with --no-verify-jwt', () => {
    const guarded = new Set(functionsWithDecodeOnlyGuard())
    const offenders = deployTable()
      .filter((c) => guarded.has(c.slug) && /--no-verify-jwt/.test(c.flags))
      .map((c) => c.slug)

    expect(
      offenders,
      `These functions authorise callers by decoding a JWT role claim, but ` +
      `apps/edge-functions/deploy.sh disables gateway verification for them: ` +
      `${offenders.join(', ')}. Under --no-verify-jwt that guard is forgeable by ` +
      `any unauthenticated caller.`,
    ).toEqual([])
  })

  it('deploys every guarded function, so none can drift from its source', () => {
    // eft-invoice was missing from the deploy list for five months. The repo
    // held a service-role guard the deployed bundle did not, which is exactly
    // how a fixed hole stays open. A function nobody deploys is a function
    // whose source proves nothing about production.
    const listed = new Set(deployTable().map((c) => c.slug))
    const missing = functionsWithDecodeOnlyGuard().filter((slug) => !listed.has(slug))

    expect(
      missing,
      `These functions carry a service-role guard but are not in deploy.sh: ` +
      `${missing.join(', ')}. Their source and their deployed bundle can silently ` +
      `disagree — add them to the FUNCTIONS table.`,
    ).toEqual([])
  })

  it('no function decodes a role claim inline instead of using the shared guard', () => {
    const offenders: string[] = []
    for (const name of readdirSync(FUNCTIONS_DIR).filter((n) => !n.startsWith('_'))) {
      const file = join(FUNCTIONS_DIR, name, 'index.ts')
      if (!existsSync(file)) continue
      const src = readFileSync(file, 'utf8')
      // An inline `atob(...)` on the token payload is the forgeable copy that
      // send-notification carried. The shared helper is the only place allowed
      // to do this, because it is the only place that documents the trust model.
      if (/atob\s*\(/.test(src)) offenders.push(name)
    }

    expect(
      offenders,
      `Inline JWT payload decoding found in: ${offenders.join(', ')}. Use ` +
      `requireServiceRole from _shared/auth.ts — its header states the one ` +
      `condition under which decoding a role claim is safe.`,
    ).toEqual([])
  })

  it('does not rebuild fn-to-fn auth from the runtime service-role key', () => {
    // The edge runtime injects SUPABASE_SERVICE_ROLE_KEY in the `sb_secret_…`
    // format, which is not a JWT, so a callee's role check can never read a
    // role out of it. Forward the caller's Authorization header instead.
    const offenders: string[] = []
    for (const name of readdirSync(FUNCTIONS_DIR).filter((n) => !n.startsWith('_'))) {
      const file = join(FUNCTIONS_DIR, name, 'index.ts')
      if (!existsSync(file)) continue
      const src = readFileSync(file, 'utf8')
      if (/Authorization[^\n]*Bearer\s*\$\{\s*Deno\.env\.get\(\s*['"]SUPABASE_SERVICE_ROLE_KEY['"]\s*\)/.test(src)) {
        offenders.push(name)
      }
    }

    expect(
      offenders,
      `These functions build an Authorization header from the runtime ` +
      `SUPABASE_SERVICE_ROLE_KEY: ${offenders.join(', ')}. That value is ` +
      `'sb_secret_…', not a JWT, so the callee rejects it — silently, because ` +
      `these calls are best-effort. Forward req.headers.get('Authorization').`,
    ).toEqual([])
  })
})
