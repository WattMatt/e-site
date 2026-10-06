/**
 * Meter roles in a load profile. A site's meters overlap: the bulk meter already includes every tenant,
 * a check meter duplicates a supply, solar and generator meters measure supply, not load. Summing them
 * all double-counts (Yarona: tenants = 2.3–2.8 × "bulk", as-is/10 §1.5). The profile is therefore:
 *
 *   Σ bulk  (when any bulk source is included)   else   Σ tenant
 *   + Σ addition                                       (new load on top: an ADMD block, a planned extension)
 *
 * check / submain / solar / generator sources are shown with their own figures and never summed. A submain is a
 * mini-sub, main DB, kiosk or summed (virtual) meter: it contains other meters but is not the site's supply.
 */
export const LOAD_ROLES = ['bulk', 'tenant', 'addition', 'check', 'submain', 'solar', 'generator'] as const
export type LoadRole = (typeof LOAD_ROLES)[number]

export type MeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'

/** Meter kind from the label part of a meter filename. Labels are hints, never a confirmed supply point. */
export function meterKindFromLabel(label: string | null, serialCount = 1): MeterKind {
  if (serialCount > 1) return 'virtual'
  const l = (label ?? '').toUpperCase()
  if (l === '') return 'unknown'
  if (/\bSOLAR\b|\bPV\d*\b/.test(l)) return 'solar'
  if (/GENERATOR|\bGEN\b/.test(l)) return 'generator'
  // Supply points INSIDE the site (they contain other meters): never the bulk supply, never a tenant.
  if (/MINI[\s-]?SUB|\bMS\b|\bMDB\b|KIOSK|\bSUB[\s-]?(STATION|BOARD)?\b/.test(l)) return 'unknown'
  if (/\bCHECK\b/.test(l)) return 'check'
  if (/COUNCIL|MUNICIPAL|ESKOM/.test(l)) return 'council'
  if (/\bBULK\b|\bMAIN\b|INCOMER/.test(l)) return 'bulk'
  if (/VACANT/.test(l)) return 'vacant'
  if (/COMMON|PARKING|LANDLORD|\bLIGHTS?\b|AMENITIES|ABLUTION/.test(l)) return 'common'
  if (/^(METER\s*\d+|E\d{3,}|DB[-\s]?\w+|\d{6,}.*|[A-Z]{1,4}\d{6,}.*)$/.test(l)) return 'unknown'
  return 'tenant'
}

/** The default role of a meter of this kind (the user can change it per source). */
export function roleOfKind(kind: MeterKind): LoadRole {
  switch (kind) {
    case 'bulk': case 'council': return 'bulk'
    case 'virtual': case 'unknown': return 'submain'
    case 'check': return 'check'
    case 'solar': return 'solar'
    case 'generator': return 'generator'
    default: return 'tenant'
  }
}

export const SUMMED_ROLES: ReadonlySet<LoadRole> = new Set(['bulk', 'tenant', 'addition'])

/**
 * Which included sources make up the profile. Returns the indices to sum and a sentence for the page.
 */
export function profileComposition(roles: readonly LoadRole[]): { sum: number[]; basis: 'bulk' | 'tenants' | 'additions_only' | 'none'; note: string } {
  const idx = (r: LoadRole) => roles.flatMap((x, i) => (x === r ? [i] : []))
  const bulk = idx('bulk')
  const tenants = idx('tenant')
  const additions = idx('addition')
  const shownOnly = roles.filter((r) => !SUMMED_ROLES.has(r)).length
  const tail = shownOnly ? ` ${shownOnly} check, sub-supply, solar or generator source${shownOnly === 1 ? ' is' : 's are'} shown but not added.` : ''
  if (bulk.length) {
    return {
      sum: [...bulk, ...additions],
      basis: 'bulk',
      note: `The profile is the bulk meter${bulk.length > 1 ? 's' : ''}${additions.length ? ' plus additions' : ''}; ${tenants.length ? `${tenants.length} tenant source${tenants.length === 1 ? ' is' : 's are'} inside the bulk supply and not added again.` : 'no tenant sources.'}${tail}`,
    }
  }
  if (tenants.length) return { sum: [...tenants, ...additions], basis: 'tenants', note: `The profile is the sum of ${tenants.length} tenant source${tenants.length === 1 ? '' : 's'}${additions.length ? ' plus additions' : ''}.${tail}` }
  if (additions.length) return { sum: additions, basis: 'additions_only', note: `The profile is the additions only.${tail}` }
  return { sum: [], basis: 'none', note: `Nothing to add up: every included source is a check, sub-supply, solar or generator meter. Set a role to bulk, tenant or addition.` }
}
