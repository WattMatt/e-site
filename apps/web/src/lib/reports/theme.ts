/** Accent resolver + spacing/size tokens for branded PDF reports. */

export const DEFAULT_ACCENT = '#E69500'

/** Resolve the accent colour: project wins, org fallback, default last. */
export function resolveAccent(
  projectAccent?: string | null,
  orgAccent?: string | null,
): string {
  return projectAccent ?? orgAccent ?? DEFAULT_ACCENT
}

/** Spacing and size tokens for the report cover layout. */
export const spacing = {
  pagePaddingH: 40,
  pagePaddingV: 48,
  accentRuleHeight: 3,
  issuerLogoMaxHeight: 36,
  issuerWordmarkFontSize: 16,
  kickerFontSize: 9,
  titleFontSize: 26,
  projectLineFontSize: 11,
  partyLogoMaxHeight: 28,
  partyLabelFontSize: 7,
  footerFontSize: 8,
  watermarkFontSize: 72,
  loremFontSize: 10,
  loremLineHeight: 1.6,
  sectionGap: 20,
  smallGap: 8,
  tinyGap: 4,
} as const
