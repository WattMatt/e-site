/**
 * Text and unit normalisation for priced BOQ lines.
 *
 * Pure. The matcher reads only normalised text, so every spelling of the same
 * thing ("2,5mm²", "2.5 mm2") must land on one form here and nowhere else.
 */

/** Canonical units. `null` = the line carried no unit. */
export type RateUnit = 'm' | 'no' | 'm2' | 'm3' | 'hr' | 'day' | 'week' | 'month' | 'sum' | 'lot' | 'kg' | 'pct' | 'pc' | 'other'

export function normaliseText(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.normalize('NFKC').toLowerCase()
  s = s.replace(/[²]/g, '2').replace(/[³]/g, '3')
  s = s.replace(/[øØ∅Φφ]/g, ' dia ')
  s = s.replace(/[‘’“”]/g, "'")
  s = s.replace(/[–—]/g, '-')
  // Thousands separators first ("11,000" — exactly three digits after the comma
  // and no further digit), then decimal commas ("2,5").
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  s = s.replace(/(\d),(\d)/g, '$1.$2')
  s = s.replace(/\bmm\s*sq\b/g, 'mm2')
  s = s.replace(/(\d)\s+mm\b/g, '$1mm')
  s = s.replace(/\s*,\s*/g, ', ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^,\s*|,\s*$/g, '').trim()
  return s
}

const UNIT_MAP: Record<string, RateUnit> = {
  m: 'm', lm: 'm', 'l/m': 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm', 'm1': 'm',
  no: 'no', 'no.': 'no', nr: 'no', each: 'no', ea: 'no', item: 'no', items: 'no', unit: 'no', units: 'no', pcs: 'no', set: 'no',
  m2: 'm2', 'm²': 'm2', sqm: 'm2',
  m3: 'm3', 'm³': 'm3', cum: 'm3',
  hr: 'hr', hrs: 'hr', hour: 'hr', hours: 'hr', h: 'hr',
  day: 'day', days: 'day', week: 'week', weeks: 'week', wk: 'week',
  month: 'month', months: 'month', mth: 'month', mths: 'month',
  sum: 'sum', 'l/s': 'sum', ls: 'sum', 'lump sum': 'sum',
  lot: 'lot', kg: 'kg', '%': 'pct', pc: 'pc', 'p.c.': 'pc', 'prov': 'pc',
}

export function normaliseUnit(raw: string | null | undefined): RateUnit | null {
  if (raw === null || raw === undefined) return null
  const k = String(raw).normalize('NFKC').trim().toLowerCase()
  if (!k) return null
  return UNIT_MAP[k] ?? 'other'
}
