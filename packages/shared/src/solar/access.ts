/**
 * Solar per-user project access levels (decision D-04, 2026-09-28).
 *
 * Mirrors the database helper public.solar_access_level(project_id), which
 * returns one of these strings or NULL. Order matters: each level includes
 * everything the levels before it allow.
 *   view            read technical tabs, no rand values
 *   edit            view + change inputs, import data, run cases
 *   edit_financials edit + tariff, financials, proposals, every rand value
 * Org owners/admins of the project's organisation always resolve to
 * edit_financials; that rule lives in SQL, not here.
 */
export const SOLAR_ACCESS_LEVELS = ['view', 'edit', 'edit_financials'] as const

export type SolarAccessLevel = (typeof SOLAR_ACCESS_LEVELS)[number]

export function isSolarAccessLevel(v: unknown): v is SolarAccessLevel {
  return typeof v === 'string' && (SOLAR_ACCESS_LEVELS as readonly string[]).includes(v)
}

/** True when `have` is at least `need`. A null `have` (no access) allows nothing. */
export function solarLevelAllows(have: SolarAccessLevel | null, need: SolarAccessLevel): boolean {
  if (have === null) return false
  return SOLAR_ACCESS_LEVELS.indexOf(have) >= SOLAR_ACCESS_LEVELS.indexOf(need)
}
