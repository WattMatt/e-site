import type { GeneratorSettings, TenantInput, TenantAllocation } from './types'
import { calculateTenantLoadingKw } from './loading'

export function calculateApportionment(
  tenants: TenantInput[],
  settings: GeneratorSettings,
  monthlyRepayment: number,
): TenantAllocation[] {
  const loads = tenants.map(t => ({ t, loadingKw: calculateTenantLoadingKw(t, settings) }))
  const totalActive = loads
    .filter(x => x.t.participation === 'shared')
    .reduce((s, x) => s + x.loadingKw, 0)

  return loads.map(({ t, loadingKw }) => {
    const active = totalActive > 0 && t.participation === 'shared'
    const portionPercent = active ? (loadingKw / totalActive) * 100 : 0
    const monthly = active ? (loadingKw / totalActive) * monthlyRepayment : 0
    const ratePerSqm = active && t.areaM2 > 0 ? monthly / t.areaM2 : 0
    return {
      shopNumber: t.shopNumber,
      shopName: t.shopName,
      areaM2: t.areaM2,
      participation: t.participation,
      loadingKw,
      portionPercent,
      monthly,
      ratePerSqm,
    }
  })
}
