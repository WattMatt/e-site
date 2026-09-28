/**
 * Site & Supply (spec §3.2) — option lists and validation shared by the form
 * (instant feedback) and saveSolarSiteAction (the real check). Column names
 * and CHECKs come from solar.studies in migration 00207; this module never
 * accepts a value the table would refuse. Warnings never block a save.
 */
import { isInSouthAfrica } from './readiness'

export const SOLAR_SUPPLY_TYPES = [
  { value: 'eskom_direct', label: 'Eskom direct' },
  { value: 'municipal', label: 'Municipal' },
  { value: 'private_resale', label: 'Private (embedded network, e.g. landlord resale)' },
] as const
export type SolarSupplyType = (typeof SOLAR_SUPPLY_TYPES)[number]['value']

export const SOLAR_EXPORT_MODES = [
  { value: 'net_billing', label: 'Yes (net billing)' },
  { value: 'no_credit', label: 'Yes (no credit)' },
  { value: 'zero_export', label: 'No (zero-export controller)' },
] as const
export type SolarExportMode = (typeof SOLAR_EXPORT_MODES)[number]['value']

export const SOLAR_VOLTAGE_PRESETS = [
  { volts: 400, label: 'LV 400 V' },
  { volts: 11000, label: 'MV 11 kV' },
  { volts: 22000, label: 'MV 22 kV' },
] as const

/** Raw form state — every value as typed. */
export interface SiteSupplyForm {
  latitude: string
  longitude: string
  elevationM: string
  licenseeName: string
  supplyType: string
  nmdKva: string
  supplyVoltageV: string
  pocNodeId: string
  exportMode: string
  exportLimitKw: string
  constraintsNote: string
}
export type SiteSupplyField = keyof SiteSupplyForm

/** Exactly the solar.studies columns this tab writes. */
export interface SiteSupplyValues {
  latitude: number | null
  longitude: number | null
  elevation_m: number | null
  licensee_name: string | null
  supply_type: SolarSupplyType | null
  nmd_kva: number | null
  supply_voltage_v: number | null
  poc_node_id: string | null
  export_mode: SolarExportMode | null
  export_limit_kw: number | null
  constraints_note: string | null
}

export interface SiteSupplyCheck {
  values: SiteSupplyValues
  errors: Partial<Record<SiteSupplyField, string>>
  warnings: Partial<Record<SiteSupplyField, string>>
}

export const EMPTY_SITE_SUPPLY_FORM: SiteSupplyForm = {
  latitude: '', longitude: '', elevationM: '', licenseeName: '', supplyType: '', nmdKva: '',
  supplyVoltageV: '', pocNodeId: '', exportMode: '', exportLimitKw: '', constraintsNote: '',
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

function parseNumber(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(',', '.')
  if (!s) return null
  if (!NUMBER.test(s)) return 'invalid'
  return Number(s)
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

const EXPORT_ALLOWED: readonly string[] = ['net_billing', 'no_credit']

export function validateSiteSupply(f: SiteSupplyForm): SiteSupplyCheck {
  const errors: SiteSupplyCheck['errors'] = {}
  const warnings: SiteSupplyCheck['warnings'] = {}
  const num = (field: SiteSupplyField, dp: number): number | null => {
    const v = parseNumber(f[field])
    if (v === 'invalid') { errors[field] = 'Enter a number'; return null }
    return v === null ? null : round(v, dp)
  }

  const latitude = num('latitude', 6)
  const longitude = num('longitude', 6)
  if (latitude !== null && (latitude < -90 || latitude > 90)) errors.latitude = 'Latitude must be between -90 and 90'
  if (longitude !== null && (longitude < -180 || longitude > 180)) errors.longitude = 'Longitude must be between -180 and 180'
  if (!errors.latitude && !errors.longitude) {
    if (latitude !== null && longitude === null) errors.longitude = 'Enter both latitude and longitude'
    if (longitude !== null && latitude === null) errors.latitude = 'Enter both latitude and longitude'
    if (latitude !== null && longitude !== null && !isInSouthAfrica(latitude, longitude)) {
      warnings.latitude = 'These coordinates are outside South Africa (latitude -35 to -22, longitude 16 to 33) — check the signs.'
    }
  }

  const elevation = num('elevationM', 1)
  if (elevation !== null && (elevation < -500 || elevation > 9000)) errors.elevationM = 'Elevation must be between -500 m and 9000 m'

  const licensee = f.licenseeName.trim()
  if (licensee.length > 200) errors.licenseeName = 'Keep the supply authority under 200 characters'

  const supplyType = f.supplyType.trim()
  if (supplyType && !SOLAR_SUPPLY_TYPES.some((t) => t.value === supplyType)) errors.supplyType = 'Choose a customer type'

  const nmd = num('nmdKva', 2)
  if (nmd !== null && nmd <= 0) errors.nmdKva = 'NMD must be more than 0 kVA'
  else if (nmd !== null && nmd > 99_999_999.99) errors.nmdKva = 'That NMD is too large — check the value'

  let voltage: number | null = null
  const rawVoltage = parseNumber(f.supplyVoltageV)
  if (rawVoltage === 'invalid' || (rawVoltage !== null && (!Number.isInteger(rawVoltage) || rawVoltage <= 0 || rawVoltage > 1_000_000))) {
    errors.supplyVoltageV = 'Enter the supply voltage in whole volts'
  } else {
    voltage = rawVoltage
  }

  const exportMode = f.exportMode.trim()
  if (exportMode && !SOLAR_EXPORT_MODES.some((m) => m.value === exportMode)) errors.exportMode = 'Choose whether export is allowed'
  let exportLimit = num('exportLimitKw', 2)
  if (!EXPORT_ALLOWED.includes(exportMode)) {
    exportLimit = null
    delete errors.exportLimitKw
  } else if (exportLimit !== null && exportLimit < 0) {
    errors.exportLimitKw = 'Export limit cannot be negative'
  }

  const note = f.constraintsNote.trim()
  if (note.length > 5000) errors.constraintsNote = 'Keep the notes under 5000 characters'

  return {
    values: {
      latitude: errors.latitude ? null : latitude,
      longitude: errors.longitude ? null : longitude,
      elevation_m: elevation,
      licensee_name: licensee || null,
      supply_type: (supplyType || null) as SolarSupplyType | null,
      nmd_kva: nmd,
      supply_voltage_v: voltage,
      poc_node_id: f.pocNodeId.trim() || null,
      export_mode: (exportMode || null) as SolarExportMode | null,
      export_limit_kw: exportLimit,
      constraints_note: note || null,
    },
    errors,
    warnings,
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    const n = Number(v)
    return v.trim() !== '' && Number.isFinite(n) && /^[-+]?\d/.test(v) ? String(n) : v
  }
  return ''
}

/** A solar.studies row (or null) → form strings. */
export function siteSupplyFormFromRow(row: Record<string, unknown> | null | undefined): SiteSupplyForm {
  if (!row) return { ...EMPTY_SITE_SUPPLY_FORM }
  return {
    latitude: str(row.latitude),
    longitude: str(row.longitude),
    elevationM: str(row.elevation_m),
    licenseeName: typeof row.licensee_name === 'string' ? row.licensee_name : '',
    supplyType: typeof row.supply_type === 'string' ? row.supply_type : '',
    nmdKva: str(row.nmd_kva),
    supplyVoltageV: str(row.supply_voltage_v),
    pocNodeId: typeof row.poc_node_id === 'string' ? row.poc_node_id : '',
    exportMode: typeof row.export_mode === 'string' ? row.export_mode : '',
    exportLimitKw: str(row.export_limit_kw),
    constraintsNote: typeof row.constraints_note === 'string' ? row.constraints_note : '',
  }
}
