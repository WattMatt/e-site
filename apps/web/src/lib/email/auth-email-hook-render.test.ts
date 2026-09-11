// @vitest-environment node
/**
 * auth-email-hook renders every GoTrue auth email. The notification actions
 * (password changed, email changed, …) are the odd ones out: GoTrue sends them
 * with `token: ""` because there is nothing to verify — they are FYI mail.
 *
 * The hook's default branch was written for "unknown/new action type: deliver
 * something usable", which is the right instinct for a *verification* action
 * and exactly wrong for a notification: it renders a headline of "Your
 * verification code", an empty monospace code box, and "this code and link
 * expire in about 24 hours". A user who just changed their password would get
 * a security email that looks broken and tells them to type a code that does
 * not exist.
 *
 * The renderer is imported and RUN here rather than grepped, so these
 * assertions fail on behaviour, not on wording of the source.
 */
import { describe, it, expect } from 'vitest'
import { renderAuthEmail } from '../../../../edge-functions/supabase/functions/auth-email-hook/render.ts'

const EMAIL = 'arno@wmeng.co.za'

function payload(action: string, token = '', extra: Record<string, unknown> = {}) {
  return {
    user: { email: EMAIL, ...(extra.user as object ?? {}) },
    email_data: {
      token,
      token_hash: 'hash-abc',
      redirect_to: '',
      email_action_type: action,
      ...(extra.email_data as object ?? {}),
    },
  } as Parameters<typeof renderAuthEmail>[0]
}

/** The empty code box is the whole defect: `.otp` with nothing inside it. */
function hasEmptyCodeBox(html: string): boolean {
  return /<div class="otp">\s*<\/div>/.test(html)
}

describe('password_changed_notification', () => {
  const out = renderAuthEmail(payload('password_changed_notification'))

  it('is a security notice, not a verification code email', () => {
    expect(out.subject.toLowerCase()).toContain('password')
    expect(out.subject.toLowerCase()).not.toContain('verification code')
    expect(out.html.toLowerCase()).not.toContain('verification code')
  })

  it('never renders an empty code box or a bogus expiry', () => {
    expect(hasEmptyCodeBox(out.html)).toBe(false)
    expect(out.html).not.toMatch(/expire in about/i)
  })

  it('names the account and offers a tokenless reset route', () => {
    expect(out.to).toBe(EMAIL)
    expect(out.html).toContain(EMAIL)
    expect(out.html).toContain('https://www.e-site.live/reset-password')
    // A notification carries no token — a token_hash link here would be a
    // one-click password reset mailed to whoever just changed the password.
    expect(out.html).not.toContain('token_hash')
  })
})

describe('the default branch is safe for any tokenless action GoTrue adds', () => {
  it('drops the code box and the expiry claim when there is no token', () => {
    const out = renderAuthEmail(payload('some_future_notification'))
    expect(hasEmptyCodeBox(out.html)).toBe(false)
    expect(out.html).not.toMatch(/expire in about/i)
  })

  it('still delivers a usable code when one IS present', () => {
    const out = renderAuthEmail(payload('some_future_verification', '123456'))
    expect(out.html).toContain('123456')
    expect(out.html).toMatch(/expire in about/i)
  })
})

describe('existing actions are unchanged', () => {
  it('recovery still carries the code and the one-click link', () => {
    const out = renderAuthEmail(payload('recovery', '654321'))
    expect(out.subject).toBe('Reset your E-Site password')
    expect(out.html).toContain('654321')
    expect(out.html).toContain('token_hash=hash-abc')
    expect(out.html).toMatch(/expire in about/i)
  })

  it('signup still carries the code and the confirm link', () => {
    const out = renderAuthEmail(payload('signup', '111222'))
    expect(out.html).toContain('111222')
    expect(out.html).toContain('type=signup')
  })
})
