import type { GeneratorCostRecoveryInput, GeneratorCostRecoveryModel, OperationalTariff } from './types'
import { calculateTotalCapitalCost, calculateMonthlyCapitalRepayment } from './capital'
import { calculateOperationalTariff } from './operational'
import { calculateApportionment } from './apportionment'
import { getFuelConsumption } from './sizing-table'

const ZERO_TARIFF: OperationalTariff = {
  dieselPerKwh: 0,
  maintenancePerKwh: 0,
  base: 0,
  contingency: 0,
  finalTariff: 0,
}

function parseKva(size: string): number {
  const m = size.match(/[\d.]+/)
  return m ? parseFloat(m[0]) : 0
}

// NOTE: tariff basis uses the largest generator by kVA across all zones.
// This is an interpretation — to be confirmed against Nexus in the golden-master step.
export function buildGeneratorCostRecovery(input: GeneratorCostRecoveryInput): GeneratorCostRecoveryModel {
  const { settings, zones, tenants } = input

  const totalCapitalCost = calculateTotalCapitalCost(zones, tenants, settings)
  const monthlyCapitalRepayment = calculateMonthlyCapitalRepayment(totalCapitalCost, settings)

  const allGens = zones.flatMap(z => z.generators)
  const largest = allGens.reduce<typeof allGens[number] | null>(
    (max, g) => (max === null || parseKva(g.size) > parseKva(max.size) ? g : max),
    null,
  )

  const tariff = largest
    ? calculateOperationalTariff(settings, {
        kva: parseKva(largest.size),
        fuelConsumptionLPerH: getFuelConsumption(largest.size, settings.runningLoadPercentage),
      })
    : ZERO_TARIFF

  const allocations = calculateApportionment(tenants, settings, monthlyCapitalRepayment)

  return { totalCapitalCost, monthlyCapitalRepayment, tariff, allocations }
}

export * from './types'
export { DEFAULT_GENERATOR_SETTINGS } from './defaults'
export { calculateTenantLoadingKw } from './loading'
export { calculateTotalCapitalCost, calculateMonthlyCapitalRepayment } from './capital'
export { getFuelConsumption } from './sizing-table'
export { calculateOperationalTariff } from './operational'
export { calculateApportionment } from './apportionment'
