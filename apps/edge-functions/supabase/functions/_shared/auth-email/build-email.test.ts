import { describe, it, expect } from 'vitest'
import { buildAuthEmail } from './build-email.ts'
import type { AuthHookPayload, OrgBranding } from './types.ts'

const SITE = 'https://app.e-site.live'
const ORG: OrgBranding = { name: 'Watson Mattheus', logoSrc: null, accent: '#E69500' }

function payload(overrides: Partial<AuthHookPayload['email_data']> & { metadata?: Record<string, unknown> }): AuthHookPayload {
  const { metadata, ...ed } = overrides
  return {
    user: { id: 'u-1', email: 'inv@example.com', user_metadata: metadata ?? {} },
    email_data: {
      token: '123456',
      token_hash: 'HASH',
      redirect_to: `${SITE}/dashboard`,
      email_action_type: 'recovery',
      site_url: SITE,
      ...ed,
    },
  }
}

describe('buildAuthEmail', () => {
  it('invite → /accept-invite link, role+site copy, OTP fallback, org-branded', () => {
    const out = buildAuthEmail(
      payload({
        email_action_type: 'invite',
        metadata: { invited_role: 'inspector', site_name: 'Kingswalk Mall', org_name: 'Watson Mattheus', inviter_name: 'Arno' },
      }),
      { siteUrl: SITE, org: ORG },
    )
    expect(out.to).toBe('inv@example.com')
    expect(out.subject).toMatch(/invited/i)
    expect(out.html).toContain(`${SITE}/accept-invite?token_hash=HASH&type=invite`)
    expect(out.html).toContain('inspector')
    expect(out.html).toContain('Kingswalk Mall')
    expect(out.html).toContain('123456')          // OTP-code fallback
    expect(out.html).toContain('via E-Site')       // org co-brand
  })

  it('recovery → /reset-password/confirm link + OTP code + 60-min expiry', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'recovery' }), { siteUrl: SITE, org: null })
    expect(out.subject).toMatch(/reset/i)
    expect(out.html).toContain(`${SITE}/auth/callback?next=/reset-password/confirm&token_hash=HASH&type=recovery`)
    expect(out.html).toContain('123456')
    expect(out.html).toContain('60 minutes')
  })

  it('signup → confirm link via /auth/callback to onboarding', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'signup' }), { siteUrl: SITE, org: null })
    expect(out.subject).toMatch(/confirm/i)
    expect(out.html).toContain(`${SITE}/auth/callback?next=/onboarding&token_hash=HASH&type=signup`)
  })

  it('magiclink → /auth/callback', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'magiclink' }), { siteUrl: SITE, org: null })
    expect(out.html).toContain(`${SITE}/auth/callback?next=/dashboard&token_hash=HASH&type=magiclink`)
  })

  it('email_change → /auth/callback', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'email_change' }), { siteUrl: SITE, org: null })
    expect(out.subject).toMatch(/email/i)
    expect(out.html).toContain(`${SITE}/auth/callback?next=/dashboard&token_hash=HASH&type=email_change`)
  })

  it('invite without metadata still renders a generic invite (no crash)', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'invite' }), { siteUrl: SITE, org: ORG })
    expect(out.subject).toMatch(/invited/i)
    expect(out.html).toContain(`${SITE}/accept-invite?token_hash=HASH&type=invite`)
  })
})
