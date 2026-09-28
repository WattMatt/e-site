/**
 * Engine spec §7 defaults register — the seed values for org settings (Phase 4b seeds
 * `/settings/solar` from this object). Decisions: D-05 insurance, D-07 finance defaults,
 * D-16 tax toggle default off. WM Solar's hard-coded fallbacks (R 2.50/kWh, 1,600/1,700 kWh/kWp,
 * R 12 k/kWp) appear NOWHERE: a missing input blocks a run with a named reason.
 *
 * Company tax rate: 27 % (SA company rate) per owner decision Q6, 2026-09-28. It is only used
 * when a case switches tax ON — the toggle defaults off (D-16).
 */
import { DEFAULT_AC_LOSSES, DEFAULT_DC_LOSSES, DEFAULT_SHADING_RACKED } from './pv/losses'
import { DEFAULT_ESCALATION } from './finance/factors'

export const SOLAR_ENGINE_DEFAULTS = {
  losses: {
    dc: DEFAULT_DC_LOSSES,
    shadingRacked: DEFAULT_SHADING_RACKED,
    ac: DEFAULT_AC_LOSSES,
  },
  albedo: 0.2,
  inverterEuroEfficiency: 0.975,
  moduleIamB0: 0.05,
  degradation: { firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  battery: { roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95 },
  finance: {
    omZarPerKwpYear: 150,
    insuranceFractionOfCapex: 0.005,
    discountRate: 0.11,
    cpi: 0.05,
    escalation: DEFAULT_ESCALATION,
    years: 25,
    replacements: { inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: 10, batteryFractionOfCapex: 0.5 },
    tax: { enabled: false, allowance: 'none' as const, companyRate: 0.27 },
  },
  load: { diversity: 1.0, commonAreaAllowanceMalls: 0.15, powerFactor: 0.95 },
} as const
