// @vitest-environment jsdom
/**
 * Two shipped defects meet on this screen.
 *
 * #13 — the Day-0 welcome has NEVER been sent. The page fired
 * `supabase.functions.invoke('onboarding-email-d0')` with the browser client
 * against a function gated on service_role. `invoke` resolves with
 * `{data, error}`, so the trailing `.catch(() => {})` never ran and the 403 was
 * invisible: zero d0 rows in email_sequence_events since 2026-04-20.
 *
 * #30 — the success card said "We sent a confirmation link to your email. Click
 * it to activate your account." `mailer_autoconfirm` is TRUE in production, so
 * GoTrue confirms the account itself and sends nothing: 0 of 36 users have
 * `confirmation_sent_at`. Together, a self-serve signup received no email at
 * all while being told to go and click one.
 *
 * The copy is asserted against what `signUp` ACTUALLY returned, not against a
 * config value this code cannot see. A live session means the account is
 * active; no session means GoTrue really is holding it for confirmation. That
 * keeps the screen honest either side of the `mailer_autoconfirm` decision.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  signUp: vi.fn(),
  invoke: vi.fn(),
  sendWelcome: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signUp: h.signUp },
    functions: { invoke: h.invoke },
  }),
}))
vi.mock('@/actions/onboarding-email.actions', () => ({
  sendWelcomeEmailAction: h.sendWelcome,
}))
vi.mock('@/components/CaptchaTurnstile', () => ({
  CaptchaTurnstile: () => null,
  CAPTCHA_ENABLED: false,
}))
vi.mock('@/components/GoogleSignInButton', () => ({ GoogleSignInButton: () => null }))
vi.mock('@/components/PasswordStrengthMeter', () => ({ PasswordStrengthMeter: () => null }))

import SignupPage from './page'

const USER = { id: '018f2d31-bbe8-4cc1-bbdd-63af0187081e' }

async function fillAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('Arno Watson'), 'Tanya Engelbrecht')
  await user.type(screen.getByPlaceholderText('you@company.co.za'), 'tanya@orionpm.co.za')
  const pw = document.querySelectorAll('input[type="password"]')
  await user.type(pw[0] as HTMLElement, 'Correct9Horse')
  await user.type(pw[1] as HTMLElement, 'Correct9Horse')
  await user.click(screen.getByLabelText(/POPIA/i, { selector: 'input' }))
  await user.click(screen.getByRole('button', { name: /create account/i }))
}

beforeEach(() => {
  h.signUp.mockReset().mockResolvedValue({ data: { user: USER, session: { access_token: 't' } }, error: null })
  h.invoke.mockReset()
  h.sendWelcome.mockReset().mockResolvedValue({ outcome: 'sent' })
})

describe('the Day-0 welcome trigger', () => {
  it('goes through the server action, never the browser client', async () => {
    render(<SignupPage />)
    await fillAndSubmit()
    await waitFor(() => expect(h.sendWelcome).toHaveBeenCalledWith(USER.id))
    // The browser holds the anon key. Any functions.invoke from here is a 403
    // that resolves quietly — the exact shape of the four-month outage.
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('does not block the user when the welcome fails', async () => {
    h.sendWelcome.mockRejectedValue(new Error('network'))
    render(<SignupPage />)
    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/account is ready/i)).toBeDefined())
  })
})

describe('the success card tells the truth', () => {
  it('with a live session: the account is active and the CTA goes to /onboarding', async () => {
    render(<SignupPage />)
    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/account is ready/i)).toBeDefined())
    expect(screen.queryByText(/sent a confirmation link/i)).toBeNull()
    expect(screen.queryByText(/check your inbox/i)).toBeNull()
    const cta = screen.getByRole('link', { name: /continue/i })
    // /login only reaches the app through a two-hop middleware bounce.
    expect(cta.getAttribute('href')).toBe('/onboarding')
  })

  it('with no session: it says a confirmation email is on its way', async () => {
    h.signUp.mockResolvedValue({ data: { user: USER, session: null }, error: null })
    render(<SignupPage />)
    await fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeDefined())
    expect(screen.getByText(/confirmation link/i)).toBeDefined()
  })
})
