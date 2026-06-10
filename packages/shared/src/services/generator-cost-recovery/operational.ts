import type { GeneratorSettings, OperationalTariff } from './types'

// Operational tariff (R/kWh). Transcribed VERBATIM from nexus generatorReportPdfBuilder.ts
// buildAppendixB page 2 (the billed-report path):
//   netKva  = largestKva × runningLoad%      netKwh = netKva × powerFactor
//   diesel/hr = fuel l/h × diesel R/l        dieselPerKwh = diesel/hr ÷ netKwh
//   maintMonthly       = annual ÷ 12
//   serviceCostPer250h = annual              (the ANNUAL figure is used directly here)
//   costServicePerMonth = (hours ÷ 250) × serviceCostPer250h
//   additionalService  = max(0, costServicePerMonth − maintMonthly)   (clamped per WM:
//                        maintenance must never reduce the tariff; fixes nexus's billed-path
//                        no-clamp quirk, which let the additional term go negative)
//   maintenancePerKwh  = additionalService ÷ (netKwh × hours)  (only the additional cost,
//                        and divided by netKwh×hours — NOT by netKwh alone)
//   base = dieselPerKwh + maintenancePerKwh ; +contingency%.
export function calculateOperationalTariff(
  s: GeneratorSettings,
  largestGen: { kva: number; fuelConsumptionLPerH: number },
): OperationalTariff {
  const netKva = largestGen.kva * (s.runningLoadPercentage / 100)
  const netKwh = netKva * s.powerFactor
  const dieselCostPerHour = largestGen.fuelConsumptionLPerH * s.dieselCostPerLitre
  const dieselPerKwh = netKwh > 0 ? dieselCostPerHour / netKwh : 0

  const maintenanceCostPerMonth = s.maintenanceCostAnnual / 12
  const serviceCostPer250h = s.maintenanceCostAnnual
  const costServicePerMonth = (s.runningHoursPerMonth / 250) * serviceCostPer250h
  // Clamped per WM (decision "2 clamp"): maintenance never reduces the tariff. This fixes
  // nexus's billed-path no-clamp quirk where a low running-hours month went negative.
  const additionalServiceCost = Math.max(0, costServicePerMonth - maintenanceCostPerMonth)
  const maintenancePerKwh =
    netKwh > 0 && s.runningHoursPerMonth > 0
      ? additionalServiceCost / (netKwh * s.runningHoursPerMonth)
      : 0

  const base = dieselPerKwh + maintenancePerKwh
  const contingency = base * (s.maintenanceContingencyPercent / 100)
  return { dieselPerKwh, maintenancePerKwh, base, contingency, finalTariff: base + contingency }
}
