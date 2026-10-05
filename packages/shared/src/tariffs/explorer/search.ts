/**
 * Alias-aware licensee search for the tariff explorer. Pure; the whole
 * registry (≈180 rows) is small enough to filter in memory.
 *
 * Names are compared two ways: in the licensee_alias normal form (trimmed,
 * single-spaced, upper case — the 00210 CHECK), and "squashed" (letters and
 * digits only), so "citypower" finds CITY POWER and "Nelson Mandela" finds
 * the registry's NELSON MANDELLA BAY METRO through its alias.
 */
import type { LicenseeKind } from '../types'

export interface LicenseeSearchItem {
  id: string
  name: string
  kind: LicenseeKind | string
  province: string | null
  aliases: readonly string[]
  /** Latest published financial year, or null when none is published. */
  liveFy: string | null
}

export interface LicenseeSearchHit extends LicenseeSearchItem {
  /** The alias that matched, when it was an alias and not the name. */
  matchedAlias: string | null
}

export function normaliseLicenseeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
}

const squash = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')

/** 0 exact · 1 prefix · 2 word prefix · 3 substring · null no match. */
function rank(candidate: string, q: string, qSquashed: string): number | null {
  const c = normaliseLicenseeText(candidate)
  const cs = squash(candidate)
  if (c === q || (qSquashed && cs === qSquashed)) return 0
  if (c.startsWith(q) || (qSquashed && cs.startsWith(qSquashed))) return 1
  if (c.split(' ').some((w) => w.startsWith(q))) return 2
  if (c.includes(q) || (qSquashed && cs.includes(qSquashed))) return 3
  return null
}

export function searchLicensees(query: string, list: readonly LicenseeSearchItem[], limit = 50): LicenseeSearchHit[] {
  const q = normaliseLicenseeText(query)
  const byName = (a: LicenseeSearchItem, b: LicenseeSearchItem) => a.name.localeCompare(b.name)
  if (!q) return [...list].sort(byName).slice(0, limit).map((l) => ({ ...l, matchedAlias: null }))
  const qs = squash(q)
  const scored: Array<{ hit: LicenseeSearchHit; r: number }> = []
  for (const l of list) {
    let best = rank(l.name, q, qs)
    let alias: string | null = null
    for (const a of l.aliases) {
      if (normaliseLicenseeText(a) === normaliseLicenseeText(l.name)) continue
      const r = rank(a, q, qs)
      if (r !== null && (best === null || r < best)) {
        best = r
        alias = a
      }
    }
    if (best !== null) scored.push({ hit: { ...l, matchedAlias: alias }, r: best })
  }
  return scored
    .sort((a, b) => a.r - b.r || Number(b.hit.liveFy !== null) - Number(a.hit.liveFy !== null) || byName(a.hit, b.hit))
    .slice(0, limit)
    .map((s) => s.hit)
}
