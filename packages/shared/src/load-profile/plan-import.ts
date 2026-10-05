/**
 * A parser outcome → what the Load profile tool can import from it. Pure; the server runs it on
 * its own re-parse (the client's view is never trusted). Roles:
 *   kw   — active power/energy, import direction (stored kW; energy converted kWh × 60 / interval)
 *   kva  — apparent power/energy, the measured-MD companion of the kW channel (never summed into load)
 *   other — shown, not importable (export, reactive, volts, amps, PF, water)
 * A daily channel is coverage-only and cannot build an hourly profile; formats D/E/F/G are not data.
 */
import type { MeterParseOutcome, ParseOptions } from '../meter-data/parse-meter-file'
import type { IssueCode, NormalisedChannel, SourceUnit } from '../meter-data/types'
import { FORMAT_LABELS } from '../meter-data/types'
import { LOAD_PROFILE_INTERVALS } from './channel'
import { meterKindFromLabel, roleOfKind, type LoadRole } from './roles'

export type ChannelRole = 'kw' | 'kva' | 'other'
export interface ImportCandidate {
  column: string
  role: ChannelRole
  sourceUnit: SourceUnit
  storedUnit: string
  intervalMin: number
  /** Plain words for the review screen: what the stored value is and how it was derived. */
  conversion: string
  eligible: boolean
  reason: string | null
  defaultSelected: boolean
  /** For a kW candidate: the kVA column of the same file paired with it for measured MD, if any. */
  kvaColumn: string | null
  stats: { usable: number; mean: number | null; max: number | null }
}
export type ImportPlan =
  | { status: 'ok'; format: string; formatLabel: string; candidates: ImportCandidate[]; warnings: string[]; suggestedRole: LoadRole }
  | { status: 'needs_options'; format: string; formatLabel: string; needs: IssueCode[]; message: string }
  | { status: 'rejected'; format: string; formatLabel: string; message: string }

/** Generic-file issues the user can resolve by confirming a choice; anything else is a rejection. */
const OPTION_CODES: IssueCode[] = ['unknown_unit', 'ambiguous_date_order', 'convention_required']
const ENERGY_UNITS: SourceUnit[] = ['kWh', 'Wh', 'MWh', 'kvarh', 'kVAh']

function roleOf(ch: NormalisedChannel): ChannelRole {
  const q = ch.spec.quantity
  if ((q === 'active_power' || q === 'active_energy') && ch.spec.direction !== 'export' && ch.spec.phase === null) return 'kw'
  if ((q === 'apparent_power' || q === 'apparent_energy') && ch.spec.phase === null) return 'kva'
  return 'other'
}

function conversionText(ch: NormalisedChannel): string {
  const u = ch.spec.sourceUnit
  if (ENERGY_UNITS.includes(u)) {
    const k = 60 / ch.intervalMin
    const scale = u === 'Wh' ? ' ÷ 1 000' : u === 'MWh' ? ' × 1 000' : ''
    return `${u} per ${ch.intervalMin} min${scale} × ${k} → average ${ch.storedUnit}`
  }
  if (u === 'W') return `W ÷ 1 000 → ${ch.storedUnit}`
  if (u === 'MW') return `MW × 1 000 → ${ch.storedUnit}`
  return `${ch.storedUnit} as recorded (average over ${ch.intervalMin} min)`
}

function ineligibleReason(ch: NormalisedChannel, role: ChannelRole): string | null {
  if (ch.coverageOnly || ch.intervalMin >= 1440) return 'Daily totals: cannot build an hourly profile or a maximum demand'
  if (!(LOAD_PROFILE_INTERVALS as readonly number[]).includes(ch.intervalMin)) return `A ${ch.intervalMin}-minute interval is not supported (5, 10, 15, 30 or 60)`
  if (ch.stats.usable === 0) return 'No usable readings'
  if (role === 'other') {
    if (ch.spec.direction === 'export') return 'Export channel: not load'
    if (ch.spec.phase !== null) return 'Single-phase channel: use the total'
    return 'Not active or apparent power'
  }
  return null
}

export function planImport(outcome: MeterParseOutcome): ImportPlan {
  const format = outcome.format
  const formatLabel = FORMAT_LABELS[format]
  if (outcome.kind === 'register') return { status: 'rejected', format, formatLabel, message: `${formatLabel}. It lists meters or downloads; it carries no readings.` }
  if (outcome.kind === 'rejected') {
    const needs = outcome.report.errors.map((e) => e.code).filter((c) => OPTION_CODES.includes(c))
    if (needs.length && needs.length === outcome.report.errors.length) {
      return { status: 'needs_options', format, formatLabel, needs: [...new Set(needs)], message: outcome.report.errors.map((e) => e.message).join(' ') }
    }
    const why = outcome.report.errors.map((e) => e.message).join(' ') || formatLabel
    return { status: 'rejected', format, formatLabel, message: why }
  }
  const roles = outcome.channels.map(roleOf)
  const firstKva = outcome.channels.find((ch, i) => roles[i] === 'kva' && !ch.spec.isScalarSum && !ineligibleReason(ch, 'kva'))
    ?? outcome.channels.find((ch, i) => roles[i] === 'kva' && !ineligibleReason(ch, 'kva'))
  const candidates = outcome.channels.map((ch, i): ImportCandidate => {
    const role = roles[i]
    const reason = ineligibleReason(ch, role)
    return {
      column: ch.spec.sourceColumn,
      role,
      sourceUnit: ch.spec.sourceUnit,
      storedUnit: ch.storedUnit,
      intervalMin: ch.intervalMin,
      conversion: conversionText(ch),
      eligible: reason === null,
      reason,
      defaultSelected: false,
      kvaColumn: role === 'kw' && firstKva && firstKva.intervalMin === ch.intervalMin ? firstKva.spec.sourceColumn : null,
      stats: { usable: ch.stats.usable, mean: ch.stats.meanUsable, max: ch.stats.maxUsable },
    }
  })
  const kw = candidates.filter((c) => c.role === 'kw' && c.eligible)
  const pick = kw.find((c) => c.column === outcome.primaryColumn) ?? kw[0]
  if (!pick) {
    const why = candidates.map((c) => c.reason).find(Boolean) ?? 'No active-power import channel'
    return { status: 'rejected', format, formatLabel, message: `Nothing to import as load: ${why}.` }
  }
  pick.defaultSelected = true
  const suggestedRole = roleOfKind(meterKindFromLabel(outcome.filename.label, outcome.sourceSerials.length))
  return { status: 'ok', format, formatLabel, candidates, warnings: outcome.report.warnings.map((w) => w.message), suggestedRole }
}

export type { ParseOptions }
