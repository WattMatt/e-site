import type { GeneratorSettings, OperationalTariff } from './types'

export function calculateOperationalTariff(
  s: GeneratorSettings,
  largestGen: { kva: number; fuelConsumptionLPerH: number },
): OperationalTariff {
  const netKva = largestGen.kva * (s.runningLoadPercentage / 100)
  const netKwh = netKva * s.powerFactor
  const monthlyDiesel = largestGen.fuelConsumptionLPerH * s.dieselCostPerLitre * s.runningHoursPerMonth
  const dieselPerKwh = netKwh === 0 ? 0 : monthlyDiesel / netKwh
  const maintMonthly = s.maintenanceCostAnnual / 12
  const serviceCostPer250h = s.maintenanceCostAnnual * (s.runningHoursPerMonth / 250 / 12)
  const additional = Math.max(0, serviceCostPer250h - maintMonthly)
  const maintenancePerKwh = netKwh === 0 ? 0 : (maintMonthly + additional) / netKwh
  const base = dieselPerKwh + maintenancePerKwh
  const contingency = base * (s.maintenanceContingencyPercent / 100)
  return { dieselPerKwh, maintenancePerKwh, base, contingency, finalTariff: base + contingency }
}
