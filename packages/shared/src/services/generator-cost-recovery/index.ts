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

// Tariff basis: the largest generator by kVA across all zones. Confirmed against nexus
// generatorReportPdfBuilder.ts buildAppendixB, which derives largestGenSize via a reduce
// using parseInt(generatorSize) and the largest of those numbers drives the tariff.
// parseInt matches nexus exactly for "NNN kVA" rating strings.
function parseKva(size: string): number {
  const n = parseInt(size, 10)
  return Number.isNaN(n) ? 0 : n
}

export function buildGeneratorCostRecovery(input: GeneratorCostRecoveryInput): GeneratorCostRecoveryModel {
  const { settings, zones, tenants } = input

  const totalCapitalCost = calculateTotalCapitalCost(zones, tenants, settings)
  const monthlyCapitalRepayment = calculateMonthlyCapitalRepayment(totalCapitalCost, settings)

  const allGens = zones.flatMap(z => z.generators)
  // Match nexus reduce: seed with the first generator, keep whichever parseInt(size) is larger.
  const largest = allGens.reduce<typeof allGens[number] | null>(
    (max, g) => (max === null || parseKva(g.size) > parseKva(max.size) ? g : max),
    allGens.length > 0 ? allGens[0] : null,
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
