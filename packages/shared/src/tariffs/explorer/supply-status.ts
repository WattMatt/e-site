/**
 * Area-of-supply status per MDB municipality, for the map. A municipality is
 * coloured by what its own distribution licensee has in the library; one no
 * licensee claims is shown as "no municipal licensee" — usually Eskom supplies
 * it directly, but the registry may simply lack its distributor. Eskom also
 * supplies parts of most licensed municipalities directly; the map says so.
 */
export type SupplyStatus = 'published' | 'in_review' | 'no_tariffs' | 'no_licensee'

export const SUPPLY_STATUS_LABELS: Record<SupplyStatus, string> = {
  published: 'Municipal licensee, tariffs published',
  in_review: 'Municipal licensee, tariffs in review',
  no_tariffs: 'Municipal licensee, no tariffs loaded',
  no_licensee: 'No municipal licensee in the registry (usually Eskom-direct)',
}

export interface MapLicensee {
  id: string
  name: string
  kind: string
  mdbCode: string | null
  /** Latest published financial year visible to the caller. */
  liveFy: string | null
  /** Any year exists (published, superseded or in review). */
  hasAnyYear: boolean
}

export interface AreaSupply {
  status: SupplyStatus
  licensee: { id: string; name: string; liveFy: string | null } | null
}

export function supplyByCode(licensees: readonly MapLicensee[]): Map<string, AreaSupply> {
  const m = new Map<string, AreaSupply>()
  for (const l of licensees) {
    if (!l.mdbCode) continue
    const status: SupplyStatus = l.liveFy ? 'published' : l.hasAnyYear ? 'in_review' : 'no_tariffs'
    m.set(l.mdbCode.toUpperCase(), { status, licensee: { id: l.id, name: l.name, liveFy: l.liveFy } })
  }
  return m
}

export function areaSupply(code: string, map: ReadonlyMap<string, AreaSupply>): AreaSupply {
  return map.get(code.toUpperCase()) ?? { status: 'no_licensee', licensee: null }
}
