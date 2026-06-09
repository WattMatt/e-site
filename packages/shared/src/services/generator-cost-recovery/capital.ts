import type { GeneratorSettings, ZoneInput, TenantInput } from './types'

export function calculateTotalCapitalCost(zones: ZoneInput[], tenants: TenantInput[], s: GeneratorSettings): number {
  const genTotal = zones.reduce((sum, z) => sum + z.generators.reduce((g, gen) => g + gen.cost, 0), 0)
  const numTenantDBs = tenants.filter(t => t.participation === 'shared').length
  const boardModCost = numTenantDBs * s.ratePerTenantDb + s.numMainBoards * s.ratePerMainBoard
  return genTotal + s.additionalCablingCost + boardModCost + s.controlWiringCost
}

export function calculateMonthlyCapitalRepayment(totalCapitalCost: number, s: GeneratorSettings): number {
  if (totalCapitalCost <= 0) return 0
  const n = s.capitalRecoveryPeriodYears
  const r = s.capitalRecoveryRatePercent / 100
  if (r === 0) return totalCapitalCost / n / 12
  const factor = Math.pow(1 + r, n)
  const annual = totalCapitalCost * ((r * factor) / (factor - 1))
  return annual / 12
}
