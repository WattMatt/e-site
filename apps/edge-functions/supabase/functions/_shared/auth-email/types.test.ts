import { describe, it, expect } from 'vitest'
import { DEFAULT_ACCENT, PLATFORM_NAME } from './types.ts'

describe('auth-email types module', () => {
  it('exposes the WM amber default accent and platform name', () => {
    expect(DEFAULT_ACCENT).toBe('#E69500')
    expect(PLATFORM_NAME).toBe('E-Site')
  })
})
