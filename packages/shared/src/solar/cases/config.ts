/**
 * Case configuration (functional spec §7.2) — stored as solar.cases.config (JSONB). Holds NO money
 * (money is solar.case_financials, gated on solar_can_see_money). A case stores its own snapshot of
 * the org defaults and of any catalogue equipment, so later changes to either never alter past results.
 */
import { z } from 'zod'
import type { SolarOrgSettingValues } from '../org-settings'
import { SOLAR_ENGINE_DEFAULTS } from '../../services/solar/defaults'
import { DEFAULT_FAIMAN } from '../../services/solar/pv/cell-temperature'

export const CASE_CONFIG_VERSION = 1 as const

const num = (min: number, max: number) => z.number().finite().min(min).max(max)
const uuid = z.string().uuid()

export const ModuleSnapshotSchema = z.object({
  equipmentId: uuid, make: z.string().min(1).max(120), model: z.string().min(1).max(120),
  pmaxW: num(1, 2000), gammaPmaxPctPerC: num(-1, 0),
}).strict()
export const InverterSnapshotSchema = z.object({
  equipmentId: uuid, make: z.string().min(1).max(120), model: z.string().min(1).max(120),
  acKw: num(0.1, 100_000), euroEfficiencyPct: num(50, 100),
}).strict()
export const BatterySnapshotSchema = z.object({
  equipmentId: uuid, make: z.string().min(1).max(120), model: z.string().min(1).max(120),
  usableKwh: num(0.1, 1e6), powerKw: num(0.1, 1e6), rtePct: num(50, 100),
}).strict()

export const CaseConfigSchema = z.object({
  version: z.literal(CASE_CONFIG_VERSION),
  pv: z.object({
    source: z.literal('manual'),
    dcKwp: num(0.1, 100_000),
    acKw: num(0.1, 100_000),
    tiltDeg: num(0, 90),
    azimuthDeg: z.number().finite().min(0).lt(360),
    mounting: z.enum(['racked', 'flush']),
    module: ModuleSnapshotSchema.nullable(),
    inverter: InverterSnapshotSchema.nullable(),
  }).strict(),
  losses: z.object({
    mode: z.enum(['standard', 'detailed']),
    soilingPct: num(0, 50), shadingPct: num(0, 50), mismatchPct: num(0, 20), dcWiringPct: num(0, 20),
    lidPct: num(0, 20), nameplatePct: num(-5, 10), acWiringPct: num(0, 20), availabilityPct: num(50, 100),
    albedo: num(0, 1), iamB0: num(0, 0.2),
    cellTemp: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('faiman'), u0: num(1, 100), u1: num(0, 50) }).strict(),
      z.object({ kind: z.literal('noct'), noctC: num(20, 80) }).strict(),
    ]),
    transposition: z.enum(['perez', 'hay-davies']),
  }).strict(),
  degradation: z.object({ firstYearPct: num(0, 20), annualPct: num(0, 5) }).strict(),
  weather: z.object({ source: z.literal('pvgis_tmy'), datasetId: uuid.nullable() }).strict(),
  battery: z.object({
    enabled: z.boolean(),
    unit: BatterySnapshotSchema.nullable(),
    usableKwh: num(0, 1e6), maxChargeKw: num(0, 1e6), maxDischargeKw: num(0, 1e6),
    rtePct: num(50, 100), socMinPct: num(0, 100), socMaxPct: num(0, 100), initialSocPct: num(0, 100),
    backupReservePct: num(0, 100),
    strategy: z.enum(['self-consumption', 'tou-arbitrage', 'peak-shaving']),
    peakTargetKw: num(0, 1e6).nullable(),
    gridCharging: z.boolean(),
  }).strict(),
  grid: z.object({
    overrideExport: z.boolean(),
    exportAllowed: z.boolean(),
    exportLimitKw: num(0, 1e6).nullable(),
    inverterAcCapKw: num(0.1, 1e6).nullable(),
  }).strict(),
  load: z.object({ adjustmentPct: num(-90, 200) }).strict(),
  loadShedding: z.object({
    enabled: z.boolean(),
    stage: z.number().int().min(1).max(8),
    hoursPerYear: num(0, 8760),
    backedLoadKw: num(0, 1e6),
  }).strict(),
}).strict().superRefine((c, ctx) => {
  const b = c.battery
  if (b.gridCharging && b.strategy !== 'tou-arbitrage') {
    ctx.addIssue({ code: 'custom', path: ['battery', 'gridCharging'], message: 'Grid charging is only allowed with TOU arbitrage' })
  }
  if (b.strategy === 'peak-shaving' && !(b.peakTargetKw !== null && b.peakTargetKw > 0)) {
    ctx.addIssue({ code: 'custom', path: ['battery', 'peakTargetKw'], message: 'Enter the peak-shaving target' })
  }
  if (b.socMaxPct <= b.socMinPct) {
    ctx.addIssue({ code: 'custom', path: ['battery', 'socMaxPct'], message: 'SoC max must be above SoC min' })
  } else if (b.initialSocPct < b.socMinPct || b.initialSocPct > b.socMaxPct) {
    ctx.addIssue({ code: 'custom', path: ['battery', 'initialSocPct'], message: 'Initial SoC must be between SoC min and max' })
  }
})

export type CaseConfig = z.infer<typeof CaseConfigSchema>
export type CaseLosses = CaseConfig['losses']

export type ParseCaseConfigResult = { ok: true; config: CaseConfig } | { ok: false; errors: Record<string, string> }

export function parseCaseConfig(raw: unknown): ParseCaseConfigResult {
  const r = CaseConfigSchema.safeParse(raw)
  if (r.success) return { ok: true, config: r.data }
  const errors: Record<string, string> = {}
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '(root)'
    if (!errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}

function setting(s: SolarOrgSettingValues, key: string, fallback: number): number {
  const v = s[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** fraction → percent without binary noise (0.07 * 100 is 7.000000000000001 in IEEE doubles). */
const toPct = (fraction: number) => Math.round(fraction * 1e8) / 1e6

const shadingFor = (mounting: 'racked' | 'flush') =>
  toPct(mounting === 'racked' ? SOLAR_ENGINE_DEFAULTS.losses.shadingRacked : SOLAR_ENGINE_DEFAULTS.losses.dc.shading)

function defaultLosses(s: SolarOrgSettingValues, mounting: 'racked' | 'flush', mode: 'standard' | 'detailed'): CaseLosses {
  const d = SOLAR_ENGINE_DEFAULTS.losses
  return {
    mode,
    soilingPct: setting(s, 'soiling_pct', toPct(d.dc.soiling)),
    shadingPct: shadingFor(mounting),
    mismatchPct: setting(s, 'mismatch_pct', toPct(d.dc.mismatch)),
    dcWiringPct: setting(s, 'dc_wiring_pct', toPct(d.dc.dcWiring)),
    lidPct: setting(s, 'lid_pct', toPct(d.dc.lid)),
    nameplatePct: 0,
    acWiringPct: setting(s, 'ac_wiring_pct', toPct(d.ac.acWiring)),
    availabilityPct: setting(s, 'availability_pct', toPct(d.ac.availability)),
    albedo: setting(s, 'albedo', SOLAR_ENGINE_DEFAULTS.albedo),
    iamB0: SOLAR_ENGINE_DEFAULTS.moduleIamB0,
    cellTemp: { kind: 'faiman', u0: DEFAULT_FAIMAN.u0, u1: DEFAULT_FAIMAN.u1 },
    transposition: 'perez',
  }
}

export function defaultCaseConfig(s: SolarOrgSettingValues, size: { dcKwp: number; acKw: number }): CaseConfig {
  const b = SOLAR_ENGINE_DEFAULTS.battery
  return {
    version: CASE_CONFIG_VERSION,
    pv: { source: 'manual', dcKwp: size.dcKwp, acKw: size.acKw, tiltDeg: 15, azimuthDeg: 0, mounting: 'racked', module: null, inverter: null },
    losses: defaultLosses(s, 'racked', 'standard'),
    degradation: {
      firstYearPct: setting(s, 'degradation_first_year_pct', toPct(SOLAR_ENGINE_DEFAULTS.degradation.firstYear)),
      annualPct: setting(s, 'degradation_annual_pct', toPct(SOLAR_ENGINE_DEFAULTS.degradation.annual)),
    },
    weather: { source: 'pvgis_tmy', datasetId: null },
    battery: {
      enabled: false, unit: null, usableKwh: 0, maxChargeKw: 0, maxDischargeKw: 0,
      rtePct: toPct(b.roundTripEfficiency), socMinPct: toPct(b.socMin), socMaxPct: toPct(b.socMax), initialSocPct: 50,
      backupReservePct: 0, strategy: 'self-consumption', peakTargetKw: null, gridCharging: false,
    },
    grid: { overrideExport: false, exportAllowed: true, exportLimitKw: null, inverterAcCapKw: null },
    load: { adjustmentPct: 0 },
    loadShedding: { enabled: false, stage: 2, hoursPerYear: 0, backedLoadKw: 0 },
  }
}

/** Standard mode shows only the standard losses; the detailed-only inputs take their defaults. */
export function effectiveLosses(c: CaseConfig): CaseLosses {
  if (c.losses.mode === 'detailed') return c.losses
  return {
    ...c.losses,
    nameplatePct: 0,
    iamB0: SOLAR_ENGINE_DEFAULTS.moduleIamB0,
    cellTemp: { kind: 'faiman', u0: DEFAULT_FAIMAN.u0, u1: DEFAULT_FAIMAN.u1 },
    transposition: 'perez',
  }
}

/** "Reset to defaults" (spec §7.2): the org values now, keeping the chosen mode. */
export function resetLossesToDefaults(c: CaseConfig, s: SolarOrgSettingValues): CaseConfig {
  return { ...c, losses: defaultLosses(s, c.pv.mounting, c.losses.mode) }
}
