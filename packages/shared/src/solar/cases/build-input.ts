/**
 * Stored case + study + site load + weather → the engine's CaseInput (engine spec §1). Every missing
 * input is a NAMED reason (engine spec §7: never substitute a number). The resulting object is what
 * gets hashed (inputs_hash) and stored as the run's inputs snapshot.
 */
import type { CaseInput } from '../../services/solar/case'
import type { BatterySpec, TouPeriod } from '../../services/solar/energy/energy-balance'
import { SOLAR_ENGINE_DEFAULTS } from '../../services/solar/defaults'
import { HOURS_PER_YEAR } from '../../services/solar/time'
import { effectiveLosses, type CaseConfig } from './config'

export type StudyExportMode = 'net_billing' | 'no_credit' | 'zero_export'

export interface BuildContext {
  config: CaseConfig
  study: { exportMode: StudyExportMode | null; exportLimitKw: number | null }
  /**
   * The site load over its reference year. `series` takes `caseLoadFromSiteSeries(...).load` (a
   * Float64Array) directly, or a plain array (a stored JSON series).
   */
  siteLoad: { series: ArrayLike<number>; basis: string; referenceYear: number } | null
  /** The case's weather dataset id is read from config.weather.datasetId. */
  touPeriods: readonly TouPeriod[] | null
}

export type BuildResult = { ok: true; input: CaseInput } | { ok: false; reasons: string[] }

export const BUILD_REASONS = {
  noWeather: 'Fetch the PVGIS weather for this site first (Weather section).',
  noLoad: 'Build the site load on the Load tab first.',
  badLoad: 'The stored site load is not a complete 8,760-hour year — rebuild it on the Load tab.',
  noModule: 'Choose a module type — it sets the temperature coefficient.',
  noExportMode: 'Set the export mode on Site & Supply, or override it for this case (Grid / export).',
  batteryEmpty: 'Enter the battery’s usable capacity and charge/discharge power, or switch the battery off.',
  noTou: 'This battery strategy needs the tariff’s TOU calendar — pin a tariff on the Tariff tab, or choose Self-consumption or Peak shaving.',
} as const

const f = (pct: number) => pct / 100

/** 8760 finite, non-negative hours (a negative hour is a series net of generation — not a load). */
function isCompleteYear(series: ArrayLike<number>): boolean {
  if (series.length !== HOURS_PER_YEAR) return false
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const v = series[h]!
    if (!Number.isFinite(v) || v < 0) return false
  }
  return true
}

export function buildCaseInput(ctx: BuildContext): BuildResult {
  const { config: c, study, siteLoad, touPeriods } = ctx
  const reasons: string[] = []
  const weatherId = c.weather.datasetId
  if (!weatherId) reasons.push(BUILD_REASONS.noWeather)
  if (!siteLoad) reasons.push(BUILD_REASONS.noLoad)
  else if (!isCompleteYear(siteLoad.series)) reasons.push(BUILD_REASONS.badLoad)
  if (!c.pv.module) reasons.push(BUILD_REASONS.noModule)
  if (!c.grid.overrideExport && study.exportMode === null) reasons.push(BUILD_REASONS.noExportMode)
  const b = c.battery
  const needsTou = b.enabled && (b.strategy === 'tou-arbitrage' || b.gridCharging)
  if (b.enabled && !(b.usableKwh > 0 && b.maxChargeKw > 0 && b.maxDischargeKw > 0)) reasons.push(BUILD_REASONS.batteryEmpty)
  if (needsTou && !touPeriods) reasons.push(BUILD_REASONS.noTou)
  if (reasons.length > 0) return { ok: false, reasons }

  const l = effectiveLosses(c)
  const acRated = c.grid.inverterAcCapKw !== null ? Math.min(c.pv.acKw, c.grid.inverterAcCapKw) : c.pv.acKw
  const euro = c.pv.inverter ? f(c.pv.inverter.euroEfficiencyPct) : SOLAR_ENGINE_DEFAULTS.inverterEuroEfficiency
  const exportSettings = c.grid.overrideExport
    ? { allowed: c.grid.exportAllowed, limitKw: c.grid.exportAllowed ? c.grid.exportLimitKw : null }
    : study.exportMode === 'zero_export'
      ? { allowed: false, limitKw: null }
      : { allowed: true, limitKw: study.exportLimitKw }

  const battery: BatterySpec | null = b.enabled
    ? {
        usableKwh: b.usableKwh, maxChargeKw: b.maxChargeKw, maxDischargeKw: b.maxDischargeKw,
        roundTripEfficiency: f(b.rtePct), socMin: f(b.socMinPct), socMax: f(b.socMaxPct),
        initialSoc: f(b.initialSocPct), backupReserve: f(b.backupReservePct),
        strategy: b.strategy === 'self-consumption' ? { kind: 'self-consumption' }
          : b.strategy === 'tou-arbitrage' ? { kind: 'tou-arbitrage', gridCharging: b.gridCharging }
            : { kind: 'peak-shaving', targetKw: b.peakTargetKw!, gridCharging: false },
      }
    : null

  const input: CaseInput = {
    weatherDatasetId: weatherId!,
    pv: {
      arrays: [{
        id: 'manual', kWpDc: c.pv.dcKwp, tiltDeg: c.pv.tiltDeg, azimuthDeg: c.pv.azimuthDeg,
        module: { gammaPmaxPerC: f(c.pv.module!.gammaPmaxPctPerC), iamB0: l.iamB0 },
        cellTemp: l.cellTemp.kind === 'faiman' ? { kind: 'faiman', u0: l.cellTemp.u0, u1: l.cellTemp.u1 } : { kind: 'noct', noctC: l.cellTemp.noctC },
        losses: { soiling: f(l.soilingPct), shading: f(l.shadingPct), mismatch: f(l.mismatchPct), dcWiring: f(l.dcWiringPct), lid: f(l.lidPct), nameplate: f(l.nameplatePct) },
        inverterId: 'inv-1',
      }],
      inverters: [{ id: 'inv-1', acRatedKw: acRated, efficiencyCurve: [{ loadFraction: 0, efficiency: euro }] }],
      acLosses: { acWiring: f(l.acWiringPct), availability: f(l.availabilityPct) },
      albedo: l.albedo,
      transposition: l.transposition,
    },
    load: Array.from(siteLoad!.series),
    loadAdjustment: f(c.load.adjustmentPct),
    battery,
    export: exportSettings,
    ...(needsTou ? { touPeriods: [...touPeriods!] } : {}),
  }
  return { ok: true, input }
}
