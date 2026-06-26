import { THEME_MODES, type ThemeMode } from './types'

/** Coerce an untrusted cookie/string value to a valid ThemeMode, defaulting to 'system'. */
export function parseThemeMode(value: string | undefined | null): ThemeMode {
  return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system'
}

/**
 * The value for the <html data-theme> attribute.
 * Returns null for 'system' — the attribute is omitted so the
 * `@media (prefers-color-scheme)` rules in globals.css take over.
 */
export function resolveDataTheme(mode: ThemeMode): 'light' | 'dark' | null {
  return mode === 'system' ? null : mode
}
