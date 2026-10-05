/**
 * The explorer's landing view before anything is typed: the national and
 * metro suppliers most people look for first, the rest of the published
 * library by province, and the authorities with nothing published yet kept
 * out of the way.
 */
import type { LicenseeSearchItem } from './search'

export const PROVINCE_LABELS: Record<string, string> = {
  national: 'National',
  EC: 'Eastern Cape',
  FS: 'Free State',
  GP: 'Gauteng',
  KZN: 'KwaZulu-Natal',
  LP: 'Limpopo',
  MP: 'Mpumalanga',
  NC: 'Northern Cape',
  NW: 'North West',
  WC: 'Western Cape',
}

export function provinceLabel(code: string | null): string {
  if (!code) return 'Province not recorded'
  return PROVINCE_LABELS[code] ?? code
}

export interface ProvinceGroup<T> {
  code: string | null
  label: string
  items: T[]
}

export interface LicenseeBrowse<T> {
  /** Eskom and the metros with a published year. */
  featured: T[]
  /** Every other authority with a published year, by province. */
  provinces: ProvinceGroup<T>[]
  /** Authorities with nothing published yet. */
  unpublished: T[]
}

const FEATURED_KINDS = new Set(['eskom', 'metro'])

export function browseLicensees<T extends LicenseeSearchItem>(list: readonly T[]): LicenseeBrowse<T> {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name)
  const live = list.filter((l) => l.liveFy)
  const featured = live.filter((l) => FEATURED_KINDS.has(String(l.kind)))
    .sort((a, b) => Number(b.kind === 'eskom') - Number(a.kind === 'eskom') || byName(a, b))
  const rest = live.filter((l) => !FEATURED_KINDS.has(String(l.kind)))
  const groups = new Map<string, T[]>()
  for (const l of rest) groups.set(l.province ?? '', [...(groups.get(l.province ?? '') ?? []), l])
  const provinces = [...groups.entries()]
    .map(([code, items]) => ({ code: code || null, label: provinceLabel(code || null), items: items.sort(byName) }))
    .sort((a, b) => Number(a.code === null) - Number(b.code === null) || a.label.localeCompare(b.label))
  return { featured, provinces, unpublished: list.filter((l) => !l.liveFy).sort(byName) }
}

const SMALL = new Set(['OF', 'AND', 'THE'])

/**
 * The registry stores most names in capitals ("CITY OF CAPE TOWN"). Shown as
 * "City of Cape Town". A name already in mixed case is left alone; a word
 * of two letters or with no vowel ("JB", "EC", "DR") is kept as written,
 * since it is usually initials or a district suffix.
 */
export function displayLicenseeName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name.split(' ').map((w, i) => {
    if (!/[A-Z]/.test(w)) return w
    if (i > 0 && SMALL.has(w)) return w.toLowerCase()
    if (!/[AEIOUY]/.test(w) || w.replace(/[^A-Z]/g, '').length <= 2) return w
    return w.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
  }).join(' ')
}
