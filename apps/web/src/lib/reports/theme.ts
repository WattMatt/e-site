/** Accent resolver + spacing/size tokens for branded PDF reports. */

export const DEFAULT_ACCENT = '#E69500'

/** Resolve the accent colour: project wins, org fallback, default last. */
export function resolveAccent(
  projectAccent?: string | null,
  orgAccent?: string | null,
): string {
  return projectAccent ?? orgAccent ?? DEFAULT_ACCENT
}

/** Spacing and size tokens for the report layout. */
export const spacing = {
  // Cover layout tokens
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
  // Interior layout tokens
  runningHeaderHeight: 28,
  runningFooterHeight: 24,
  headerLogoMaxHeight: 14,
  headerFontSize: 8,
  sectionHeadingFontSize: 13,
  sectionRuleHeight: 2,
  rowLabelFontSize: 9,
  rowValueFontSize: 10,
  rowGap: 6,
  pillFontSize: 8,
  pillPaddingH: 6,
  pillPaddingV: 2,
  failReasonFontSize: 8,
  photoGridCols: 3, // column count, not pt
  photoCellGap: 6,
  photoCaptionFontSize: 6,
  tableHeaderFontSize: 8,
  tableCellFontSize: 9,
  annexureRowFontSize: 9,
  signatureImageMaxHeight: 60,
  auditRowFontSize: 7,
} as const

/** Colour scheme for pass/fail/na/null pill states. Pure function; no side effects. */
export function passPillColors(
  pass: 'pass' | 'fail' | 'na' | null,
): { bg: string; fg: string } {
  switch (pass) {
    case 'pass':
      return { bg: '#D1FAE5', fg: '#065F46' } // light green / dark green
    case 'fail':
      return { bg: '#FEE2E2', fg: '#991B1B' } // light red / dark red
    case 'na':
      return { bg: '#F3F4F6', fg: '#374151' } // light grey / dark grey
    case null:
    default:
      return { bg: '#F9FAFB', fg: '#6B7280' } // very light grey / medium grey
  }
}
