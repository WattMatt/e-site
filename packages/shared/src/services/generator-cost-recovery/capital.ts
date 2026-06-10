import type { GeneratorSettings, ZoneInput, TenantInput } from './types'

export function calculateTotalCapitalCost(zones: ZoneInput[], tenants: TenantInput[], s: GeneratorSettings): number {
  const genTotal = zones.reduce((sum, z) => sum + z.generators.reduce((g, gen) => g + gen.cost, 0), 0)
  // esite extends nexus's binary own_generator with a 'none' (opt-out) state.
  // Both 'own' and 'none' are excluded from the board-mod count. nexus only checks
  // !ownGenerator, so 'none' has no nexus equivalent — this is an esite-only model
  // choice (D10). ⚠ Open for WM: should opt-out tenants still incur a tenant-DB capital line?
  const numTenantDBs = tenants.filter(t => t.participation === 'shared').length
  const boardModCost = numTenantDBs * s.ratePerTenantDb + s.numMainBoards * s.ratePerMainBoard
  return genTotal + s.additionalCablingCost + boardModCost + s.controlWiringCost
}

// PMT monthly repayment. Anchored to WM's real Rev-6 standby-power report (the AUTHORITATIVE
// billed source of truth): ANNUAL compounding, monthly = annual annuity ÷ 12 —
// r = annualRate% / 100, annual = P · r(1+r)^years / ((1+r)^years − 1), monthly = annual / 12.
// Proven by the report's amortisation schedule (Year-1 interest = capex × rate, i.e. annual
// interest), e.g. R4 455 360 @ 12% / 10y → annual R788 528.17 → /12 = R65 710.68/mo.
// This DELIBERATELY diverges from nexus's code (calculateMonthlyRepayment in
// generatorReportPdfBuilder.ts), which compounds MONTHLY (r/12, n=years×12) and thereby
// under-charges by ~2.72%. WM's published report — not nexus's code — is ground truth here.
export function calculateMonthlyCapitalRepayment(totalCapitalCost: number, s: GeneratorSettings): number {
  const years = s.capitalRecoveryPeriodYears
  if (totalCapitalCost <= 0 || years <= 0) return 0
  const r = s.capitalRecoveryRatePercent / 100
  if (r === 0) return totalCapitalCost / years / 12
  const factor = Math.pow(1 + r, years)
  const annual = totalCapitalCost * ((r * factor) / (factor - 1))
  return annual / 12
}
