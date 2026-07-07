// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AuthHashErrorRedirect } from './AuthHashErrorRedirect'

const replaceMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock }) }))

beforeEach(() => {
  replaceMock.mockReset()
  window.history.replaceState(null, '', '/')
  window.location.hash = ''
})

describe('AuthHashErrorRedirect', () => {
  it('forwards a GoTrue error fragment to the reset-password code step', () => {
    window.location.hash =
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).toHaveBeenCalledWith(
      '/reset-password?step=code&error=otp_expired&reason=link-expired',
    )
  })

  it('falls back to the error param when error_code is absent', () => {
    window.location.hash = '#error=access_denied'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).toHaveBeenCalledWith(
      '/reset-password?step=code&error=access_denied&reason=link-expired',
    )
  })

  it('never touches success fragments carrying access_token', () => {
    window.location.hash = '#access_token=abc&refresh_token=def&type=recovery'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('is a no-op without a hash', () => {
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('is a no-op on unrelated anchors', () => {
    window.location.hash = '#pricing'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('ignores error fragments on non-auth pages (crafted-link ejection guard)', () => {
    window.history.replaceState(null, '', '/settings/users')
    window.location.hash = '#error=access_denied&error_code=otp_expired'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('still fires on /auth/* paths where GoTrue bounces land', () => {
    window.history.replaceState(null, '', '/auth/callback')
    window.location.hash = '#error=access_denied&error_code=otp_expired'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).toHaveBeenCalledWith(
      '/reset-password?step=code&error=otp_expired&reason=link-expired',
    )
  })

  it('ignores error codes the reset-password flow cannot help with', () => {
    window.location.hash = '#error=server_error&error_code=email_change_failed'
    render(<AuthHashErrorRedirect />)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('renders nothing', () => {
    const { container } = render(<AuthHashErrorRedirect />)
    expect(container.innerHTML).toBe('')
  })
})
