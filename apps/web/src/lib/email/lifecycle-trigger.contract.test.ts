// @vitest-environment node
/**
 * The two event-triggered lifecycle emails — Day-0 welcome and the
 * second-project conversion prompt — have both sent ZERO mail since the day
 * they shipped, for three separate reasons that no test could see:
 *
 *   1. Both edge functions gate on `requireServiceRole`. Both were invoked
 *      with a client that does not hold the service key (the browser client
 *      for d0; the caller's cookie-bound server client for conversion-prompt).
 *   2. `supabase.functions.invoke` RESOLVES with `{data, error}` — it does not
 *      reject — so a `void …invoke(…).catch(() => {})` swallows a 100% failure
 *      rate without a single log line.
 *   3. conversion-prompt resolves the org owner with `.eq('role','org_admin')`.
 *      `org_admin` is not in ORG_ROLES and is rejected by the
 *      user_organisations_role_check CHECK constraint, so it matches zero rows
 *      in production and returns 404 even WITH a valid service-role JWT.
 *
 * These are source contracts because the shape is the bug: the caller, the
 * awaiting, and the role vocabulary. Each assertion below fails if its fix is
 * reverted.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORG_ROLES } from '@esite/shared'

// apps/web/src/lib/email -> five levels up is the repo root.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const readRaw = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

/**
 * Comments are prose ABOUT the bug — every file fixed here explains the shape
 * it must never take again, in the words the assertion greps for. A contract
 * test that reads them fires on its own documentation (this exact trap caught
 * PR #159). Block comments are blanked line-for-line so line numbers in any
 * failure message still point at real code.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1)
}

const read = (rel: string) => stripComments(readRaw(rel))

const WEB_SIGNUP = 'apps/web/src/app/(auth)/signup/page.tsx'
const MOBILE_SIGNUP = 'apps/mobile/app/(auth)/signup.tsx'
const VERIFY_EMAIL = 'apps/web/src/app/(auth)/verify-email/page.tsx'
const PROJECT_ACTIONS = 'apps/web/src/actions/project.actions.ts'
const CONVERSION_FN = 'apps/edge-functions/supabase/functions/conversion-prompt/index.ts'

describe('a service-role edge function is never invoked from the browser', () => {
  it('the signup page triggers d0 through a server action', () => {
    const src = read(WEB_SIGNUP)
    expect(src).toContain("'use client'")
    // The browser holds the anon key. Any invoke from a 'use client' file
    // against a requireServiceRole function is a silent 403.
    expect(src).not.toMatch(/supabase\.functions\.invoke/)
    expect(src).toMatch(/await sendWelcomeEmailAction\(/)
  })
})

describe('conversion-prompt is invoked by something that holds the key', () => {
  const src = read(PROJECT_ACTIONS)

  it('uses the service client, not the caller-scoped one', () => {
    expect(src).toMatch(/createServiceClient\(\)[\s\S]{0,80}invoke\('conversion-prompt'/)
    expect(src).not.toMatch(/void supabase\.functions/)
  })

  it('awaits the call and logs the verdict', () => {
    // `void …invoke().catch(() => {})` is what made a total outage invisible.
    expect(src).not.toMatch(/invoke\('conversion-prompt'[\s\S]{0,200}catch\(\(\) => \{\}\)/)
    expect(src).toMatch(/await[\s\S]{0,120}invoke\('conversion-prompt'/)
    const after = src.slice(src.indexOf("invoke('conversion-prompt'"))
    expect(after.slice(0, 400)).toMatch(/console\.error/)
  })
})

describe('conversion-prompt speaks the canonical role vocabulary', () => {
  const src = read(CONVERSION_FN)
  // Grab the role filter on the user_organisations lookup, whatever its shape.
  const roleFilter = src.match(/\.(?:eq|in)\('role',\s*(\[[^\]]*\]|'[^']*')\)/)

  it('filters on a role at all', () => {
    expect(roleFilter, 'no .eq/.in on role found in conversion-prompt').toBeTruthy()
  })

  it('every role literal it filters on exists in ORG_ROLES', () => {
    // `org_admin` looked plausible in review, matched nothing in production,
    // and is rejected by the user_organisations_role_check CHECK constraint.
    const literals = [...roleFilter![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThan(0)
    for (const role of literals) {
      expect(ORG_ROLES as readonly string[], `unknown org role '${role}'`).toContain(role)
    }
  })

  it('addresses the owner or admin, the roles that actually hold the org', () => {
    const literals = [...roleFilter![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(literals).toContain('owner')
    expect(literals).toContain('admin')
  })
})

describe('no screen promises a confirmation email that GoTrue never sends', () => {
  it('the mobile success screen branches on whether the account is already active', () => {
    const src = read(MOBILE_SIGNUP)
    // mailer_autoconfirm is TRUE: 0 of 36 production users have
    // confirmation_sent_at. The old copy told every mobile signup to click a
    // link that was never sent.
    expect(src).toMatch(/activated\s*\?/)
    expect(src).toMatch(/getSession\(\)/)
    expect(src).toMatch(/no confirmation email/i)
  })

  it('the verify-email page does not state a link was sent as fact', () => {
    const src = read(VERIFY_EMAIL)
    expect(src).not.toMatch(/We sent a confirmation link/i)
  })
})
