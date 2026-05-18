/**
 * Auto-suggest a short tag code from a descriptive board name.
 *
 * Recognises common SA electrical board types and substitutes their
 * standard abbreviations. Numbers and dots are preserved (so "MAIN
 * BOARD 1.1" becomes "MB1.1"). Output is uppercase, alphanumerics +
 * hyphens + dots only, capped at 12 chars (the cable_schedule.boards
 * short_code length constraint added in migration 00062).
 *
 * Engineers can override the suggestion in the bulk-edit UI — this
 * is a "starting point", not an authoritative mapping.
 */

const SUBSTITUTIONS: Array<[RegExp, string]> = [
  // Order matters — longer patterns first to avoid partial matches.
  [/\bminiature\s+substations?\b/gi, 'MS'],
  [/\bmotor\s+control\s+(centre|center)s?\b/gi, 'MCC'],
  [/\bring\s+main\s+units?\b/gi, 'RMU'],
  [/\bsub[-\s]?distribution\s+boards?\b/gi, 'SDB'],
  [/\bdistribution\s+boards?\b/gi, 'DB'],
  [/\bmain\s+boards?\b/gi, 'MB'],
  [/\blighting\s+boards?\b/gi, 'LDB'],
  [/\bemergency\s+boards?\b/gi, 'EDB'],
  [/\bgenerator\s+boards?\b/gi, 'GENDB'],
  [/\bgenerators?\b/gi, 'GEN'],
  [/\bups\s+boards?\b/gi, 'UPSDB'],
  [/\btransformers?\b/gi, 'TX'],
  [/\bsubstations?\b/gi, 'SS'],
  [/\bswitchboards?\b/gi, 'SWB'],
  [/\bcouncil\b/gi, 'K'],     // Disambiguates Council-RMU vs Consumer-RMU
  [/\bconsumer\b/gi, 'C'],
  [/\bbasement\b/gi, 'B'],
  [/\blevel\s+/gi, 'L'],
  [/\bfloor\s+/gi, 'F'],
]

export function suggestShortCode(boardCode: string): string {
  if (!boardCode) return ''

  let result = boardCode

  // Apply word-substitutions
  for (const [re, repl] of SUBSTITUTIONS) {
    result = result.replace(re, repl)
  }

  // Collapse whitespace, normalise separators
  result = result
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/[^A-Z0-9.\-]/gi, '')  // strip anything not alphanumeric/dot/hyphen
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .toUpperCase()

  // Cap at 12 chars (matches the migration 00062 CHECK)
  return result.slice(0, 12)
}
