import type { GeneratorSettings, ZoneInput, TenantInput } from './types'

export function calculateTotalCapitalCost(zones: ZoneInput[], tenants: TenantInput[], s: GeneratorSettings): number {
  const genTotal = zones.reduce((sum, z) => sum + z.generators.reduce((g, gen) => g + gen.cost, 0), 0)
  const numTenantDBs = tenants.filter(t => t.participation === 'shared').length
  const boardModCost = numTenantDBs * s.ratePerTenantDb + s.numMainBoards * s.ratePerMainBoard
  return genTotal + s.additionalCablingCost + boardModCost + s.controlWiringCost
}

// PMT monthly repayment. Transcribed VERBATIM from nexus generatorReportPdfBuilder.ts
// calculateMonthlyRepayment (the billed-report path): MONTHLY compounding —
// r = (annualRate% / 100) / 12, n = years × 12, PMT = P · r(1+r)^n / ((1+r)^n − 1).
// (Note: this differs from an annual-compounding annuity; nexus compounds monthly.)
export function calculateMonthlyCapitalRepayment(totalCapitalCost: number, s: GeneratorSettings): number {
  const years = s.capitalRecoveryPeriodYears
  if (totalCapitalCost <= 0 || years <= 0) return 0
  const r = s.capitalRecoveryRatePercent / 100 / 12
  if (r === 0) return totalCapitalCost / (years * 12)
  const n = years * 12
  return (totalCapitalCost * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1)
}
