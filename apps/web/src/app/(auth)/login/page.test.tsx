// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const search = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => search.value }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
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
vi.mock('@/components/GoogleSignInButton', () => ({
  GoogleSignInButton: () => null,
}))

import LoginPage from './page'

beforeEach(() => {
  search.value = new URLSearchParams()
})

describe('LoginPage — ?error= bounce banner', () => {
  it('renders the expired-link message with a reset-password link for otp_expired', () => {
    search.value = new URLSearchParams('error=otp_expired')
    render(<LoginPage />)
    expect(screen.getByText(/expired or was already used/i)).toBeDefined()
    const link = screen.getByRole('link', { name: /6-digit code/i })
    expect(link.getAttribute('href')).toBe('/reset-password?step=code&reason=link-expired')
  })

  it('renders a rejection message for access_denied', () => {
    search.value = new URLSearchParams('error=access_denied')
    render(<LoginPage />)
    expect(screen.getByText(/link was rejected/i)).toBeDefined()
  })

  it('renders a message for auth_callback_failed', () => {
    search.value = new URLSearchParams('error=auth_callback_failed')
    render(<LoginPage />)
    expect(screen.getByText(/couldn.t sign you in with that link/i)).toBeDefined()
  })

  it('falls back to a generic message without echoing unknown codes', () => {
    search.value = new URLSearchParams('error=pay+here+evil.example')
    render(<LoginPage />)
    expect(screen.getByText(/something went wrong with that sign-in link/i)).toBeDefined()
    expect(screen.queryByText(/evil\.example/)).toBeNull()
  })

  it('shows no banner on a normal load', () => {
    render(<LoginPage />)
    expect(screen.queryByText(/sign-in link/i)).toBeNull()
    expect(document.querySelector('.auth-alert-error')).toBeNull()
  })
})
