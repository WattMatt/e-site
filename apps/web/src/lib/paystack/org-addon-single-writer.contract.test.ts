import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * billing.org_addon_subscriptions has exactly ONE writer: the Paystack
 * webhook (service client). The subscribe route writes nothing (spec §1.2),
 * and a second writer is how mv-subscribe once downgraded an active
 * subscriber to 'pending'. This fails the build if any other non-test file
 * under apps/web/src names the table.
 *
 * A future READER (e.g. Phase 1C's locked-page poll) must be added to
 * ALLOWED with a comment saying it only SELECTs — the point is that the
 * decision is made on purpose, in review, not by accident.
 *
 * Comments are stripped before the check: the subscribe route and the
 * org-addon helpers EXPLAIN the table in prose (that is how a reader learns
 * who writes it), and prose is not a query.
 */

const WEB_SRC = resolve(__dirname, '../..') // apps/web/src
// Also the shared package (and mobile, when present): a writer added there is
// just as much a second writer. Paths below are relative to the repo root.
const REPO = resolve(WEB_SRC, '../../..')
const ROOTS = ['apps/web/src', 'packages/shared/src', 'apps/mobile/src', 'apps/mobile/app']
  .map((r) => join(REPO, r))
  .filter((r) => existsSync(r))

const ALLOWED = new Set<string>([
  'apps/web/src/app/api/paystack/webhook/route.ts', // the single writer
])

/** Drop block and line comments so prose about the table is not a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('billing.org_addon_subscriptions — single writer', () => {
  it('is named only by the webhook route', () => {
    expect(ROOTS.length).toBeGreaterThanOrEqual(2) // web + shared at minimum
    const offenders = ROOTS.flatMap((r) => walk(r))
      .filter((f) => code(readFileSync(f, 'utf8')).includes('org_addon_subscriptions'))
      .map((f) => relative(REPO, f))
      .filter((f) => !ALLOWED.has(f))
    expect(offenders).toEqual([])
  })

  it('the allowed writer actually names it (the check is not vacuous)', () => {
    const src = readFileSync(join(WEB_SRC, 'app/api/paystack/webhook/route.ts'), 'utf8')
    expect(code(src)).toContain("from('org_addon_subscriptions')")
  })

  it('comment stripping keeps code and drops prose (the check cannot be blinded by it)', () => {
    expect(code("// org_addon_subscriptions\n/* org_addon_subscriptions */")).not.toContain('org_addon_subscriptions')
    expect(code("const t = 'org_addon_subscriptions' // write")).toContain('org_addon_subscriptions')
    expect(code("fetch('https://x/org_addon_subscriptions')")).toContain('org_addon_subscriptions')
  })
})
