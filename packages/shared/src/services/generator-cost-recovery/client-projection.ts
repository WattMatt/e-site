import type {
  GeneratorCostRecoveryModel,
  ClientGcrReviewPayload,
  ClientGcrBankRow,
} from './types'

/**
 * Bank input for the client projection. zoneName + the free-text generator
 * sizes assigned to the bank + the total assigned tenant load on that bank.
 */
export interface ClientBankInput {
  zoneName: string
  generatorSizes: string[]
  assignedLoadKw: number
}

/**
 * Parse a numeric kVA value out of a free-text generator size such as
 * "500 kVA" / "1000kva". Returns null when no number can be found.
 */
export function parseGeneratorKva(size: string): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(size ?? '')
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

/**
 * SECURITY-CRITICAL allow-list projection. Copies ONLY outputs-only fields from
 * the engine model into the client-facing payload. Never read totalCapitalCost,
 * tariff.dieselPerKwh/maintenancePerKwh/base/contingency, GeneratorSettings, or
 * generators[].cost here. The snapshot stored for clients IS this payload, so a
 * field omitted here is physically absent from the client's data.
 */
export function toClientReviewPayload(
  model: GeneratorCostRecoveryModel,
  banks: ClientBankInput[],
): ClientGcrReviewPayload {
  const tenants = model.allocations.map((a) => ({
    shopNumber: a.shopNumber,
    shopName: a.shopName,
    areaM2: a.areaM2,
    participation: a.participation,
    loadingKw: a.loadingKw,
    portionPercent: a.portionPercent,
    monthly: a.monthly,
    ratePerSqm: a.ratePerSqm,
  }))

  const bankRows: ClientGcrBankRow[] = banks.map((b) => {
    const installedKva = b.generatorSizes.reduce<number | null>((sum, s) => {
      const kva = parseGeneratorKva(s)
      if (kva === null) return sum
      return (sum ?? 0) + kva
    }, null)
    const utilisationPercent =
      installedKva && installedKva > 0
        ? Math.round((b.assignedLoadKw / installedKva) * 100)
        : null
    return { zoneName: b.zoneName, installedKva, utilisationPercent }
  })

  return {
    tenants,
    banks: bankRows,
    scheme: {
      monthlyCapitalRepayment: model.monthlyCapitalRepayment,
      finalTariff: model.tariff.finalTariff,
    },
  }
}
