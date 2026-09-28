/**
 * Display vocabulary for the Tariff tab and the tariff library (spec §0.4
 * rule 3: every number shows its unit; units are stored, never inferred).
 * Deterministic formatting: no Intl, no locale.
 */
import type { ChargeComponent, TariffCategory, TariffSeason, TariffUnit, TouOrAll } from '../../tariffs/types'

export const UNIT_LABELS: Record<TariffUnit, string> = {
  c_per_kWh: 'c/kWh',
  R_per_kWh: 'R/kWh',
  R_per_month: 'R/month',
  R_per_day: 'R/day',
  R_per_kVA_month: 'R/kVA/month',
  R_per_kW_month: 'R/kW/month',
  R_per_A_month: 'R/A/month',
  c_per_kVArh: 'c/kVArh',
  R_per_POD_day: 'R/POD/day',
  pct: '%',
}

export const COMPONENT_LABELS: Record<ChargeComponent, string> = {
  energy: 'Energy',
  legacy: 'Legacy charge',
  basic: 'Basic charge',
  service: 'Service charge',
  admin: 'Administration charge',
  network_capacity: 'Network capacity',
  network_demand: 'Network demand',
  transmission_network: 'Transmission network',
  gcc: 'Generation capacity (GCC)',
  ancillary: 'Ancillary service',
  ers: 'Electrification & rural subsidy',
  affordability: 'Affordability subsidy',
  lv_subsidy: 'LV subsidy',
  reactive: 'Reactive energy',
  demand: 'Demand',
  capacity_amp: 'Capacity (per amp)',
  export_credit: 'Export credit',
  wheeling_uos: 'Wheeling use-of-system',
  loss_factor: 'Loss factor',
  other: 'Other',
}

/**
 * Named TARIFF_CATEGORY_LABELS (not CATEGORY_LABELS): the root barrel already
 * exports handover's CATEGORY_LABELS (services/handover/folder-templates.ts).
 */
export const TARIFF_CATEGORY_LABELS: Record<TariffCategory, string> = {
  domestic: 'Domestic',
  commercial: 'Commercial',
  industrial: 'Industrial',
  agricultural: 'Agricultural',
  bulk: 'Bulk',
  public_lighting: 'Public lighting',
  sseg: 'SSEG / export',
  wheeling: 'Wheeling',
  other: 'Other',
}

export const SEASON_LABELS: Record<TariffSeason, string> = {
  all: 'All year',
  high: 'High demand (winter)',
  low: 'Low demand (summer)',
}

export const TOU_LABELS: Record<TouOrAll, string> = {
  all: 'All hours',
  peak: 'Peak',
  standard: 'Standard',
  off_peak: 'Off-peak',
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "R3,000.00"; negative as "-R12.50". Half away from zero at the cent. */
export function formatRandAmount(x: number): string {
  const neg = x < 0
  const cents = Math.round(Math.abs(x) * 100)
  const whole = Math.floor(cents / 100)
  const frac = String(cents % 100).padStart(2, '0')
  return `${neg && cents !== 0 ? '-' : ''}R${groupThousands(String(whole))}.${frac}`
}

/** A stored rate with its unit. Rand-per-kWh keeps 4 dp (tariff books publish 4). */
export function formatChargeAmount(amount: number, unit: TariffUnit): string {
  if (unit === 'c_per_kWh' || unit === 'c_per_kVArh') return `${amount.toFixed(2)} ${UNIT_LABELS[unit]}`
  if (unit === 'pct') return `${amount.toFixed(2)} %`
  if (unit === 'R_per_kWh') return `R${amount.toFixed(4)}/kWh`
  return `${formatRandAmount(amount)}${UNIT_LABELS[unit].slice(1)}`
}
