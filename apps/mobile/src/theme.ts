import { Platform } from 'react-native'

// Mirrors web globals.css :root tokens. Source of truth for mobile colors,
// typography, spacing, and radius. Import { colors, spacing, ... } from
// '@/src/theme' instead of hardcoding hex values in StyleSheet.create.

export const colors = {
  // Surfaces
  base: '#0D0B09',
  surface: '#161310',
  panel: '#1D1A16',
  elevated: '#252118',

  // Borders
  border: '#2A2520',
  borderMid: '#382E25',
  borderHi: '#4A3E30',

  // Text
  text: '#EDE8DF',
  textMid: '#9A8F80',
  textDim: '#544D43',

  // Accents
  amber: '#E8923A',
  amberDim: '#3D2108',
  amberMid: '#7A3D10',
  green: '#3DB882',
  greenDim: '#0D3322',
  greenMid: '#1A5C3A',
  red: '#E85555',
  redDim: '#381212',
  redMid: '#6B1E1E',
  blue: '#5B9CF6',
  blueDim: '#0F254A',
  blueMid: '#1F3D70',

  // Snag-priority high (between amber and red, matches web .priority-high)
  orange: '#F08030',

  // Static
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
} as const

// System fallbacks — swap to 'Syne' / 'JetBrains Mono' once expo-font is wired.
export const fontFamily = {
  sans: undefined as string | undefined,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const

export const fontSize = {
  micro: 9,
  tiny: 10,
  caption: 11,
  small: 12,
  body: 13,
  bodyLg: 14,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 36,
} as const

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const

// Mono UPPERCASE caption used across web for KPI labels, badges, metadata.
export const monoLabel = {
  fontFamily: fontFamily.mono,
  fontSize: fontSize.micro,
  fontWeight: fontWeight.semibold,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: colors.textDim,
} as const

// ─── Semantic helpers ────────────────────────────────────────────

export type SnagPriority = 'critical' | 'high' | 'medium' | 'low'

export const priorityColor = (priority: string): string => {
  switch (priority) {
    case 'critical':
      return colors.red
    case 'high':
      return colors.orange
    case 'medium':
      return colors.amber
    case 'low':
    default:
      return colors.textDim
  }
}

export type StatusBadgeStyle = { bg: string; fg: string; border: string }

export const statusBadge = (status: string): StatusBadgeStyle => {
  switch (status) {
    case 'open':
      return { bg: colors.redDim, fg: colors.red, border: colors.redMid }
    case 'in_progress':
    case 'pending_sign_off':
      return { bg: colors.amberDim, fg: colors.amber, border: colors.amberMid }
    case 'resolved':
      return { bg: colors.blueDim, fg: colors.blue, border: colors.blueMid }
    case 'signed_off':
      return { bg: colors.greenDim, fg: colors.green, border: colors.greenMid }
    case 'closed':
    default:
      return { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid }
  }
}
