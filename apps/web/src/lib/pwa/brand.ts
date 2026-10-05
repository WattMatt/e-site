/**
 * Install-surface colours. The app's own tokens live in globals.css; these are
 * the values the OS needs before any CSS loads (manifest, theme-color, splash).
 */
export const PWA_BRAND = {
  name: 'E-Site',
  description: 'Construction management for SA electrical contractors',
  amber: '#E8923A',
  /** --c-base (dark): splash and manifest background. */
  base: '#0B0B12',
  /** --c-surface: browser/status bar colour, matching the app header. */
  surfaceDark: '#13131E',
  surfaceLight: '#F2EEE6',
} as const
