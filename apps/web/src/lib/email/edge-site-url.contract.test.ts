// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// apps/web/src/lib/email  ->  five levels up is the repo root.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const FN = 'apps/edge-functions/supabase/functions'

const FILES = [
  `${FN}/_shared/email-sequence.ts`,
  `${FN}/send-email/index.ts`,
]

const DEFAULT_RE = /SITE_URL\s*=\s*Deno\.env\.get\('SITE_URL'\)\s*\?\?\s*'([^']+)'/

function siteUrlDefault(rel: string): string {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')
  const m = src.match(DEFAULT_RE)
  if (!m) throw new Error(`no SITE_URL default found in ${rel}`)
  return m[1]
}

describe('edge senders agree on the SITE_URL default', () => {
  it('both fall back to the canonical production host', () => {
    // app.e-site.live has NO DNS RECORD. It is the host that dead-ended every
    // invite link in the PR #138 otp_expired incident. A sender that defaults
    // to it produces mail whose buttons go nowhere, and the only symptom is
    // "nobody clicks".
    for (const f of FILES) {
      expect(siteUrlDefault(f), f).toBe('https://www.e-site.live')
    }
  })

  it('the two files do not disagree with each other', () => {
    const [a, b] = FILES.map(siteUrlDefault)
    expect(a).toBe(b)
  })
})
