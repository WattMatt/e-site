// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { ThemeToggle } from './ThemeToggle'

vi.mock('@/lib/theme/actions', () => ({
  setThemePreference: vi.fn().mockResolvedValue(undefined),
}))
import { setThemePreference } from '@/lib/theme/actions'

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.removeAttribute('data-theme')
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
})

describe('ThemeToggle', () => {
  it('cycles light → dark: sets data-theme and persists', () => {
    render(<ThemeProvider initialMode="light"><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(setThemePreference).toHaveBeenCalledWith('dark')
  })

  it('cycles dark → system: clears data-theme and persists', () => {
    render(<ThemeProvider initialMode="dark"><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(setThemePreference).toHaveBeenCalledWith('system')
  })
})
