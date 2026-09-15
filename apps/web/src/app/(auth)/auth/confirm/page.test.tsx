// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

import AuthConfirmPage from './page'

type Params = Record<string, string | string[] | undefined>

async function renderPage(params: Params) {
  return render(await AuthConfirmPage({ searchParams: Promise.resolve(params) }))
}

describe('/auth/confirm — single-use link interstitial', () => {
  it('renders a form that POSTs the token back to /auth/callback', async () => {
    const { container } = await renderPage({
      token_hash: 'htok123',
      type: 'recovery',
      next: '/reset-password/confirm',
    })
    const form = container.querySelector('form')
    expect(form?.getAttribute('action')).toBe('/auth/callback')
    expect(form?.getAttribute('method')).toBe('post')
    expect(
      (container.querySelector('input[name="token_hash"]') as HTMLInputElement).value,
    ).toBe('htok123')
    expect((container.querySelector('input[name="type"]') as HTMLInputElement).value).toBe(
      'recovery',
    )
    expect((container.querySelector('input[name="next"]') as HTMLInputElement).value).toBe(
      '/reset-password/confirm',
    )
    expect(screen.getByRole('button').textContent).toContain('Set my password')
  })

  it('defaults next to /dashboard and adapts copy per OTP type', async () => {
    const { container } = await renderPage({ token_hash: 'htok456', type: 'magiclink' })
    expect((container.querySelector('input[name="next"]') as HTMLInputElement).value).toBe(
      '/dashboard',
    )
    expect(screen.getByRole('button').textContent).toContain('Sign in')
  })

  it('carries from and email as hidden fields when present', async () => {
    const { container } = await renderPage({
      token_hash: 'htok123',
      type: 'recovery',
      from: 'invite',
      email: 'user@co.za',
    })
    expect((container.querySelector('input[name="from"]') as HTMLInputElement).value).toBe(
      'invite',
    )
    expect((container.querySelector('input[name="email"]') as HTMLInputElement).value).toBe(
      'user@co.za',
    )
  })

  it('redirects to /login when token_hash is missing', async () => {
    await expect(renderPage({ type: 'recovery' })).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=auth_callback_failed',
    )
  })

  it('redirects to /login on an unknown OTP type', async () => {
    await expect(renderPage({ token_hash: 'htok123', type: 'not_a_type' })).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=auth_callback_failed',
    )
  })
})
