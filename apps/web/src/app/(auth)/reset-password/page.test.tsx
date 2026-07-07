// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const search = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => search.value,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: vi.fn(),
      verifyOtp: vi.fn(),
    },
  }),
}))
vi.mock('@/actions/auth-event.actions', () => ({
  recordAuthEventAction: vi.fn(async () => undefined),
}))
vi.mock('@/components/CaptchaTurnstile', () => ({
  CaptchaTurnstile: () => null,
  CAPTCHA_ENABLED: false,
}))

import ResetPasswordPage from './page'

const BANNER = /expired or was already used/i

beforeEach(() => {
  search.value = new URLSearchParams()
})

describe('ResetPasswordPage — link-expired banner', () => {
  it('shows the friendly banner on the code step and asks for the email when unknown', () => {
    search.value = new URLSearchParams('step=code&error=otp_expired&reason=link-expired')
    render(<ResetPasswordPage />)
    expect(screen.getByText('Enter your code')).toBeDefined()
    expect(screen.getByText(BANNER)).toBeDefined()
    // The friendly banner replaces the terse "Link rejected (…)" alert.
    expect(screen.queryByText(/link rejected/i)).toBeNull()
    // No email in the URL → the code alone can't verify, so ask for it.
    expect(screen.getByPlaceholderText('you@company.co.za')).toBeDefined()
  })

  it('shows the banner on the email step too', () => {
    search.value = new URLSearchParams('reason=link-expired')
    render(<ResetPasswordPage />)
    expect(screen.getByText('Reset password')).toBeDefined()
    expect(screen.getByText(BANNER)).toBeDefined()
  })

  it('keeps the raw error surface when the bounce has no reason', () => {
    search.value = new URLSearchParams('step=code&error=otp_expired&email=user%40co.za')
    render(<ResetPasswordPage />)
    expect(screen.getByText(/link rejected \(otp_expired\)/i)).toBeDefined()
    expect(screen.queryByText(BANNER)).toBeNull()
    // Email came through the URL → no extra email field on the code step.
    expect(screen.queryByPlaceholderText('you@company.co.za')).toBeNull()
  })

  it('shows neither banner nor error on a normal load', () => {
    render(<ResetPasswordPage />)
    expect(screen.getByText('Reset password')).toBeDefined()
    expect(screen.queryByText(BANNER)).toBeNull()
    expect(document.querySelector('.auth-alert-error')).toBeNull()
  })
})
