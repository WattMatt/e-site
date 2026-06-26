import { describe, it, expect } from 'vitest'
import { parseThemeMode, resolveDataTheme } from './resolve'

describe('parseThemeMode', () => {
  it('returns the value when it is a valid mode', () => {
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
    expect(parseThemeMode('system')).toBe('system')
  })

  it('falls back to "system" for missing or invalid values', () => {
    expect(parseThemeMode(undefined)).toBe('system')
    expect(parseThemeMode('')).toBe('system')
    expect(parseThemeMode('purple')).toBe('system')
  })
})

describe('resolveDataTheme', () => {
  it('maps explicit modes to the data-theme attribute value', () => {
    expect(resolveDataTheme('light')).toBe('light')
    expect(resolveDataTheme('dark')).toBe('dark')
  })

  it('returns null for system so the attribute is omitted (CSS media query decides)', () => {
    expect(resolveDataTheme('system')).toBeNull()
  })
})
