/**
 * The curated licensee registry (owner default 4, 2026-09-28): who the
 * licensees are, their kind and province, and every spelling a source uses for
 * them. Seeded from a reviewed data file BEFORE any ingestion, so ingestion
 * resolves licensees by alias instead of inventing them from sheet names.
 * Pure: the seed script supplies the existing registry and applies the plan.
 */
import type { LicenseeKind } from '../types'
import { normaliseAlias } from './ingest-core'

export const PROVINCES = ['EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NW', 'NC', 'WC', 'national'] as const
export type Province = (typeof PROVINCES)[number]

const KINDS: readonly LicenseeKind[] = ['eskom', 'municipal', 'metro', 'private', 'development_agency', 'industrial_private']

export interface RegistryEntry {
  /** Canonical display name (licensee.name, unique). */
  name: string
  kind: LicenseeKind
  /** From the registry, never from the file a source was filed under (Sasol is filed under KZN). */
  province: Province | null
  /** Normalised (see normaliseAlias); unique across the registry. */
  aliases: string[]
  notes: string | null
}

/** Owner default 4: the 8 metros, Eskom, the non-municipal distributors; everything else municipal. */
export function classifyLicensee(name: string): LicenseeKind {
  const n = normaliseAlias(name)
  if (/^ESKOM\b/.test(n)) return 'eskom'
  if (/^CITY POWER\b|JOHANNESBURG|TSHWANE|EKURHULENI|^CITY OF CAPE\b|CAPE TOWN|ETHEKWINI|NELSON MANDEL+A BAY|^BUFFALO CITY\b/.test(n)) return 'metro'
  if (/MANGAUNG/.test(n) && !/^CENTLEC\s*-\s*KOPANONG/.test(n)) return 'metro'
  if (/^SASOL/.test(n)) return 'industrial_private'
  if (/^ITHALA\b|^MEGA$|ECONOMIC GROWTH AGENCY/.test(n)) return 'development_agency'
  if (/^AECI\b|^WESTRAND PRIVATE|^VLEES ?BAAI|^DAMPLAAS\b/.test(n)) return 'private'
  return 'municipal'
}

export function validateRegistry(entries: readonly RegistryEntry[]): string[] {
  const problems: string[] = []
  const names = new Set<string>()
  const owner = new Map<string, string>()
  for (const e of entries) {
    if (e.name.trim() === '') problems.push('an entry has a blank name')
    if (names.has(e.name)) problems.push(`duplicate name "${e.name}"`)
    names.add(e.name)
    if (!KINDS.includes(e.kind)) problems.push(`"${e.name}": unknown kind "${e.kind}"`)
    if (e.province !== null && !(PROVINCES as readonly string[]).includes(e.province)) problems.push(`"${e.name}": unknown province "${e.province}"`)
    if (e.aliases.length === 0) problems.push(`"${e.name}": no aliases`)
    for (const a of e.aliases) {
      if (a !== normaliseAlias(a) || a === '') problems.push(`"${e.name}": alias "${a}" is not normalised`)
      const held = owner.get(a)
      if (held !== undefined && held !== e.name) problems.push(`alias "${a}" is claimed by "${held}" and "${e.name}"`)
      else owner.set(a, e.name)
    }
  }
  return problems
}

export interface ExistingRegistry {
  licensees: { id: string; name: string }[]
  aliases: { alias: string; licenseeId: string }[]
}

export interface RegistrySeedPlan {
  insert: RegistryEntry[]
  addAliases: { licenseeId: string; name: string; aliases: string[] }[]
  conflicts: { alias: string; wanted: string; heldBy: string }[]
  /** Entries not inserted because an alias is held by a different licensee: resolve by hand. */
  blocked: RegistryEntry[]
  unchanged: number
}

export function planRegistrySeed(entries: readonly RegistryEntry[], existing: ExistingRegistry): RegistrySeedPlan {
  const byName = new Map(existing.licensees.map((l) => [l.name, l.id]))
  const nameById = new Map(existing.licensees.map((l) => [l.id, l.name]))
  const aliasOwner = new Map(existing.aliases.map((a) => [a.alias, a.licenseeId]))
  const plan: RegistrySeedPlan = { insert: [], addAliases: [], conflicts: [], blocked: [], unchanged: 0 }
  for (const e of entries) {
    const id = byName.get(e.name) ?? null
    const missing: string[] = []
    let conflicted = false
    for (const a of e.aliases) {
      const holder = aliasOwner.get(a)
      if (holder === undefined) missing.push(a)
      else if (holder !== id) {
        plan.conflicts.push({ alias: a, wanted: e.name, heldBy: nameById.get(holder) ?? holder })
        conflicted = true
      }
    }
    if (id === null) {
      if (conflicted) plan.blocked.push(e)
      else plan.insert.push(e)
    } else if (missing.length > 0) {
      plan.addAliases.push({ licenseeId: id, name: e.name, aliases: missing })
    } else if (!conflicted) {
      plan.unchanged++
    }
  }
  return plan
}
