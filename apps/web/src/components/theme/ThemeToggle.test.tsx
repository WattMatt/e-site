// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { ThemeToggle } from './ThemeToggle'

// Stub the browser Supabase client so persist() doesn't reach the network.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(),
  }),
}))

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.cookie = 'theme=; path=/; max-age=0'
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
})

describe('ThemeToggle', () => {
  it('cycles light → dark: sets data-theme and cookie', () => {
    render(<ThemeProvider initialMode="light"><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.cookie).toContain('theme=dark')
  })

  it('cycles dark → system: clears data-theme and writes system cookie', () => {
    render(<ThemeProvider initialMode="dark"><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.cookie).toContain('theme=system')
  })
})
