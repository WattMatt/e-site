import { parseUnitToken } from '../units'
import type { ChargeComponent, TariffCategory, TariffMetering, TariffSeason, TariffUnit, TouPeriod } from '../types'

/** Bullets used by the Cape Town sheet ("·", "o", "§", "Ø"), NBSPs and line breaks go. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[·•§Ø▪\-–]+|o(?=\s))\s*/u, '')
    .trim()
}

/** Low = summer / low-demand (Sep-May); high = winter / high-demand (Jun-Aug). */
export function detectSeason(label: string): TariffSeason | null {
  const t = label.toLowerCase()
  if (/\ball[- ]seasons?\b/.test(t)) return 'all'
  if (/summer|\blow[- ]season\b|\blow[- ]demand\b/.test(t)) return 'low'
  if (/winter|\bhigh[- ]season\b|\bhigh[- ]demand\b/.test(t)) return 'high'
  return null
}

/** Off-peak is tested BEFORE peak (the old parser read "off-peak" as "peak"). */
export function detectTou(label: string): TouPeriod | null {
  const t = label.toLowerCase()
  if (/\boff[- ]?peak\b/.test(t)) return 'off_peak'
  if (/\bstandard\b/.test(t)) return 'standard'
  if (/\bpeak\b/.test(t)) return 'peak'
  return null
}

const EXPLICIT_UNIT = /(c\/kwh|r\/kwh|c\/kvarh|r\/kva(?:\/m(?:onth)?)?|\/kva|r\/pod\/day|r\/day|r\/month|per month|r\/a\/m)/i

/** A unit written in a label: the last parenthesis that names one, else an explicit token. */
export function labelUnit(label: string): TariffUnit | null {
  const parens = [...label.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).reverse()
  for (const p of parens) {
    const u = parseUnitToken(p)
    if (u) return u
  }
  const m = EXPLICIT_UNIT.exec(label)
  return m ? parseUnitToken(m[1]) : null
}

/**
 * The component a label names. The UNIT wins where it is decisive (c/kVArh is
 * reactive even when the label says "Demand" — City Power). A context hint is
 * used only when the label itself is silent.
 */
export function detectComponent(label: string, unit: TariffUnit | null, hint: ChargeComponent | null): ChargeComponent {
  const t = label.toLowerCase()
  if (unit === 'c_per_kVArh' || /reactive|kvarh/.test(t)) return 'reactive'
  if (/wheeling/.test(t)) return 'wheeling_uos'
  if (/network capacity|access charge/.test(t)) return 'network_capacity'
  if (/network demand/.test(t)) return 'network_demand'
  if (/generation capacity/.test(t)) return 'gcc'
  if (/transmission network/.test(t)) return 'transmission_network'
  if (/ancillary/.test(t)) return 'ancillary'
  if (/legacy/.test(t)) return 'legacy'
  if (/electrification|rural network subsidy/.test(t)) return 'ers'
  if (/affordability/.test(t)) return 'affordability'
  if (/\badmin/.test(t) && !/service/.test(t)) return 'admin'
  if (/service/.test(t)) return 'service'
  if (/capacity charge/.test(t)) return /\bamp/.test(t) || unit === 'R_per_A_month' ? 'capacity_amp' : 'network_capacity'
  if (/demand/.test(t) && (unit === 'R_per_kVA_month' || unit === 'R_per_kW_month')) return 'demand'
  if (/basic|levy|fixed charge|daily charge/.test(t)) return 'basic'
  if (unit === 'c_per_kWh' || unit === 'R_per_kWh') return hint === 'export_credit' ? 'export_credit' : 'energy'
  if (/energy|kwh|block|part \d|peak|standard|charge per|single rate|flat rate|consumption/.test(t)) {
    return hint === 'export_credit' ? 'export_credit' : 'energy'
  }
  if (hint) return hint
  if (unit === 'R_per_month' || unit === 'R_per_day') return 'basic'
  if (unit === 'R_per_kVA_month' || unit === 'R_per_kW_month') return 'demand'
  return 'other'
}

export function detectCategory(text: string): TariffCategory | null {
  const t = text.toLowerCase()
  if (/sseg|small[- ]scale embedded|embedded generat|gen-?offset|feed[- ]in|\bexport\b/.test(t)) return 'sseg'
  if (/wheeling/.test(t)) return 'wheeling'
  if (/street|public lighting|robots/.test(t)) return 'public_lighting'
  if (/agric|farm|landrate|ruraflex/.test(t)) return 'agricultural'
  if (/\bbulk\b/.test(t)) return 'bulk'
  if (/industr|large power|\blpu\b|megaflex|miniflex|nightsave|municflex/.test(t)) return 'industrial'
  if (/commerc|business/.test(t)) return 'commercial'
  if (/domestic|residential|household|indigent|home/.test(t)) return 'domestic'
  return null
}

export function detectMetering(text: string): TariffMetering {
  const t = text.toLowerCase()
  const prepaid = /prepaid|prepayment/.test(t)
  const conventional = /conventional|credit metered/.test(t)
  if (prepaid && conventional) return 'both'
  if (prepaid) return 'prepaid'
  if (conventional) return 'conventional'
  return 'both'
}

export function detectPhase(text: string): 'single' | 'three' | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  if (/single phase|1 phase/.test(t)) return 'single'
  if (/three phase|3 phase/.test(t)) return 'three'
  return null
}

export function voltageBandFromText(text: string | null): string | null {
  if (!text) return null
  const s = text.replace(/\s+/g, '').toLowerCase()
  if (/^<500v/.test(s)) return 'lt_500v'
  if (/^(≥|>=)500v&<66kv/.test(s)) return '500v_66kv'
  if (/^(≥|>=)500v&(≤|<=)22kv/.test(s)) return '500v_22kv'
  if (/^(≥|>=)66kv&(≤|<=)132kv/.test(s)) return '66kv_132kv'
  if (/^>132kv/.test(s)) return 'gt_132kv'
  return s
}
