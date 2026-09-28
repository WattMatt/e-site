/**
 * Fixed per-format column tables (engine spec §2.1 step 3; as-is/10 §6.1 step 4). The unit is
 * NEVER inferred from magnitude and never defaulted: an unrecognised column is 'unknown' and the
 * caller must supply a unit before the channel can be imported.
 * Reactive quadrants (IEC 62053-23): import = Q1+Q2, export = Q3+Q4. A's q12/q34 follow that.
 */
import type { ChannelSpec, Direction, Phase, Quantity, SourceUnit, StoredUnit } from './types'
import { SOURCE_UNITS } from './types'

export type NonChannelColumn = 'date' | 'time' | 'timestamp' | 'status'

const A_CODE = /^([pqsa])(14|23|12|34)(?:_l([123]))?$/

function spec(sourceColumn: string, columnIndex: number, quantity: Quantity, direction: Direction, sourceUnit: SourceUnit, phase: Phase = null): ChannelSpec {
  return { sourceColumn, columnIndex, quantity, direction, phase, sourceUnit, unitFromTable: sourceUnit !== 'unknown' }
}

export function mapColumnA(header: string, columnIndex: number): ChannelSpec {
  const h = header.trim()
  const lower = h.toLowerCase()
  const m = lower.match(A_CODE)
  if (m) {
    const [, letter, quad, ph] = m
    const direction: Direction = quad === '14' || quad === '12' ? 'import' : 'export'
    const phase = ph ? (`l${ph}` as Phase) : null
    if (letter === 'p') return spec(h, columnIndex, 'active_power', direction, 'kW', phase)
    if (letter === 'q') return spec(h, columnIndex, 'reactive_power', direction, 'kvar', phase)
    if (letter === 's') return spec(h, columnIndex, 'apparent_power', direction, 'kVA', phase)
    return spec(h, columnIndex, 'active_energy', direction, 'kWh', phase)
  }
  const v = lower.match(/^u_l([123])$/)
  if (v) return spec(h, columnIndex, 'voltage', 'none', 'V', `l${v[1]}` as Phase)
  const i = lower.match(/^i_l([123])$/)
  if (i) return spec(h, columnIndex, 'current', 'none', 'A', `l${i[1]}` as Phase)
  if (/total power$|active power$/.test(lower)) return spec(h, columnIndex, 'active_power', 'import', 'kW')
  if (lower === 'volume') return spec(h, columnIndex, 'volume', 'none', 'm3')
  return spec(h, columnIndex, 'unknown', 'none', 'unknown')
}

export function mapColumnB(header: string, columnIndex: number): ChannelSpec | NonChannelColumn {
  const h = header.replace(/"/g, '').trim()
  const upper = h.toUpperCase()
  if (upper === 'DATE') return 'date'
  if (upper === 'TIME') return 'time'
  if (upper === 'STATUS') return 'status'
  let m = h.match(/^P([12]?) \(per kW\)$/i)
  if (m) return spec(h, columnIndex, 'active_power', m[1] === '2' ? 'export' : 'import', 'kW')
  m = h.match(/^Q([1-4]?) \(per kvar\)$/i)
  if (m) return spec(h, columnIndex, 'reactive_power', m[1] === '3' || m[1] === '4' ? 'export' : 'import', 'kvar')
  if (/^scalar sum S \(per kVA\)$/i.test(h)) return { ...spec(h, columnIndex, 'apparent_power', 'none', 'kVA'), isScalarSum: true }
  if (/^S \(per kVA\)$/i.test(h)) return spec(h, columnIndex, 'apparent_power', 'none', 'kVA')
  return spec(h, columnIndex, 'unknown', 'none', 'unknown')
}

export function mapColumnC(header: string, columnIndex: number): ChannelSpec | NonChannelColumn {
  const h = header.trim()
  if (/^time$/i.test(h)) return 'timestamp'
  if (/^status$/i.test(h)) return 'status'
  let m = h.match(/^P([12]) \(kWh\)$/i)
  if (m) return spec(h, columnIndex, 'active_energy', m[1] === '2' ? 'export' : 'import', 'kWh')
  m = h.match(/^Q([1-4]) \(kvarh\)$/i)
  if (m) return spec(h, columnIndex, 'reactive_energy', m[1] === '3' || m[1] === '4' ? 'export' : 'import', 'kvarh')
  if (/^S \(kVAh\)$/i.test(h)) return spec(h, columnIndex, 'apparent_energy', 'none', 'kVAh')
  if (/^S \(kVA\)$/i.test(h)) return spec(h, columnIndex, 'apparent_power', 'none', 'kVA')
  return spec(h, columnIndex, 'unknown', 'none', 'unknown')
}

export function mapColumnGeneric(header: string, columnIndex: number): ChannelSpec {
  const h = header.trim()
  return spec(h, columnIndex, 'unknown', /export|\bp2\b|kwh-|kw-/i.test(h) ? 'export' : 'import', 'unknown')
}

/** A suggestion to show the user on the generic path; never applied automatically. */
export function suggestUnitFromHeader(header: string): SourceUnit | null {
  const m = header.match(/[([]\s*(kWh|kW|MWh|MW|Wh|W|kvarh|kvar|kVAh|kVA|V|A)\s*[)\]]/i)
  if (!m) return null
  return SOURCE_UNITS.find((u) => u.toLowerCase() === m[1].toLowerCase()) ?? null
}

export function quantityForUnit(u: SourceUnit): Quantity {
  switch (u) {
    case 'kW': case 'W': case 'MW': return 'active_power'
    case 'kWh': case 'Wh': case 'MWh': return 'active_energy'
    case 'kvar': return 'reactive_power'
    case 'kvarh': return 'reactive_energy'
    case 'kVA': return 'apparent_power'
    case 'kVAh': return 'apparent_energy'
    case 'V': return 'voltage'
    case 'A': return 'current'
    case 'PF': return 'power_factor'
    case 'm3': return 'volume'
    default: return 'unknown'
  }
}

export function withUnit(s: ChannelSpec, unit: SourceUnit): ChannelSpec {
  return { ...s, sourceUnit: unit, quantity: unit === 'unknown' ? s.quantity : quantityForUnit(unit), unitFromTable: false }
}

export function storedUnitFor(q: Quantity): StoredUnit {
  switch (q) {
    case 'active_power': case 'active_energy': return 'kW'
    case 'reactive_power': case 'reactive_energy': return 'kvar'
    case 'apparent_power': case 'apparent_energy': return 'kVA'
    case 'voltage': return 'V'
    case 'current': return 'A'
    case 'power_factor': return 'PF'
    case 'volume': return 'm3'
    default: return 'unknown'
  }
}

/** Energy per interval → average power over the interval; W/MW → k. */
export function toStoredValue(v: number, s: Pick<ChannelSpec, 'quantity' | 'sourceUnit'>, intervalMin: number): number {
  const perHour = 60 / intervalMin
  switch (s.sourceUnit) {
    case 'W': return v / 1000
    case 'MW': return v * 1000
    case 'kWh': case 'kvarh': case 'kVAh': return v * perHour
    case 'Wh': return (v / 1000) * perHour
    case 'MWh': return v * 1000 * perHour
    default: return v
  }
}
