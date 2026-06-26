export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const

export const THEME_COOKIE = 'theme'

// 1 year — the preference is sticky; the user changes it deliberately.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
