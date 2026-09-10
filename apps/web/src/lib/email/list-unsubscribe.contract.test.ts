// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * List-Unsubscribe contract (RFC 2369 + RFC 8058).
 *
 * The edge functions are Deno modules that read Deno.env at import time and
 * pull supabase-js from esm.sh, so they cannot be imported into vitest; this
 * repo already guards them by reading their source (edge-site-url.contract.test).
 * Text alone would be weak, so the assertions that carry weight here are the
 * CROSS-FILE ones: the URL the header advertises must resolve to a route
 * handler that exists, that handles POST, and that the middleware does not
 * redirect. Any one of those three missing makes the header decorative — the
 * provider renders an Unsubscribe button that fails silently, which is a
 * strictly worse version of the bug being fixed, because now the failure is
 * invisible to us as well as to the recipient.
 *
 * apps/web/src/lib/email -> five levels up is the repo root.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

const SEQ = readFileSync(
  resolve(ROOT, 'apps/edge-functions/supabase/functions/_shared/email-sequence.ts'),
  'utf8',
)
const MIDDLEWARE = readFileSync(resolve(ROOT, 'apps/web/src/middleware.ts'), 'utf8')

// The path the header points at, read out of the sender rather than hardcoded
// here — so renaming it in one place cannot leave this file agreeing with
// itself while production disagrees.
function oneClickPath(): string {
  const m = SEQ.match(/ONE_CLICK_UNSUBSCRIBE_PATH\s*=\s*'([^']+)'/)
  if (!m) throw new Error('email-sequence.ts declares no ONE_CLICK_UNSUBSCRIBE_PATH')
  return m[1]
}

describe('lifecycle email carries a working unsubscribe header', () => {
  it('emits both RFC 8058 headers, with the exact One-Click token', () => {
    // 'List-Unsubscribe=One-Click' is the literal RFC 8058 requires. Any other
    // spelling and Gmail/Outlook treat the message as having no one-click
    // support at all — no error, just no button.
    expect(SEQ).toMatch(/'List-Unsubscribe'\s*:/)
    expect(SEQ).toMatch(/'List-Unsubscribe-Post'\s*:\s*'List-Unsubscribe=One-Click'/)
  })

  it('angle-brackets the URI, as RFC 2369 requires', () => {
    expect(SEQ).toMatch(/'List-Unsubscribe'\s*:\s*`<\$\{[^}]+\}>`/)
  })

  it('actually attaches the headers to the Resend request body', () => {
    // The old resendSend posted from/to/subject/html only. A header builder
    // nobody calls is the same as no header builder.
    expect(SEQ).toMatch(/body:\s*JSON\.stringify\(\{[^}]*headers/)
    expect(SEQ).toMatch(/resendSend\([\s\S]{0,200}listUnsubscribeHeaders\(/)
  })

  it('points at a route handler that exists', () => {
    const path = oneClickPath()
    expect(path.startsWith('/api/')).toBe(true)
    const file = resolve(ROOT, `apps/web/src/app${path}/route.ts`)
    expect(existsSync(file), `no route handler at app${path}/route.ts`).toBe(true)
  })

  it('points at a handler that accepts POST — a page.tsx would 405 the one-click', () => {
    const src = readFileSync(resolve(ROOT, `apps/web/src/app${oneClickPath()}/route.ts`), 'utf8')
    expect(src).toMatch(/export\s+(async\s+)?function\s+POST\s*\(/)
  })

  it('points at a path the middleware does not redirect', () => {
    // Without the bypass the provider's cookieless POST is 307'd to /login and
    // recorded as a failed one-click. This is the same defect the page itself
    // had for its entire life.
    const m = MIDDLEWARE.match(/PUBLIC_API_PATHS\s*=\s*\[([^\]]*)\]/)
    expect(m, 'middleware.ts declares no PUBLIC_API_PATHS').toBeTruthy()
    expect(m![1]).toContain(`'${oneClickPath()}'`)
  })

  it('builds the URL on SITE_URL, not a hardcoded host', () => {
    // app.e-site.live has no DNS record (PR #138). A hardcoded host here would
    // reintroduce it in the one place nobody reads: a mail header.
    expect(SEQ).toMatch(/listUnsubscribeHeaders[\s\S]{0,400}\$\{SITE_URL\}/)
  })
})
