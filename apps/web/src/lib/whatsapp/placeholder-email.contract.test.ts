// apps/web/src/lib/whatsapp/placeholder-email.contract.test.ts
// @vitest-environment node
// A WhatsApp-invited external has a placeholder email on a no-MX domain. If
// GoTrue ever tries to mail it (recovery, email change), the platform mailer
// must refuse BEFORE calling Resend — a bounce storm is what nearly cost the
// sending domain in July.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOOK = resolve(__dirname, '../../../../edge-functions/supabase/functions/auth-email-hook/index.ts')

describe('auth-email-hook placeholder guard', () => {
  it('checks isPlaceholderEmail before the Resend fetch', () => {
    const src = readFileSync(HOOK, 'utf8')
    const guard = src.indexOf('isPlaceholderEmail(')
    const send = src.indexOf("fetch('https://api.resend.com/emails'")
    expect(guard).toBeGreaterThan(-1)
    expect(send).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(send)
  })
})
