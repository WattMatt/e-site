import { describe, expect, it } from 'vitest'
import { energyBalance } from '../energy/energy-balance'
import { stubBillCalculator } from '../__fixtures__/stub-bill-calculator'
import { year1Bills, type BillCalculator } from './bill-calculator'

const N = 8760
const pv = Float64Array.from({ length: N }, (_, h) => (h % 24 === 12 ? 10 : 0))
const load = new Float64Array(N).fill(4)
const common = { pvAc: pv, load, loadAdjustment: 0, export: { allowed: true, limitKw: null } }
const battery = {
  usableKwh: 10, maxChargeKw: 5, maxDischargeKw: 5, roundTripEfficiency: 0.81, socMin: 0, socMax: 1,
  initialSoc: 0, backupReserve: 0, strategy: { kind: 'self-consumption' as const },
}

describe('year1Bills through a BillCalculator', () => {
  const withBatt = energyBalance({ ...common, battery })
  const pvOnly = energyBalance({ ...common, battery: null })
  const y = year1Bills(stubBillCalculator, withBatt, pvOnly)

  it('prices the no-PV load, PV-only and PV+battery flows (stub: R2/kWh, R500/month, export R1/kWh)', () => {
    expect(y.beforeZar).toBeCloseTo(12 * 500 + 96 * 365 * 2, 6)
    expect(y.afterPvOnlyZar).toBeCloseTo(12 * 500 + 92 * 365 * 2 - 6 * 365, 6)
    expect(y.afterZar).toBeCloseTo(12 * 500 + 87.95 * 365 * 2 - 1 * 365, 6)
    expect(y.exportCreditUsedZar).toBeCloseTo(365, 6)
  })

  it('refuses a calculator that does not return twelve valid months', () => {
    const bad: BillCalculator = { monthlyBills: () => [] }
    expect(() => year1Bills(bad, withBatt, pvOnly)).toThrow(/12 monthly bills/)
    const neg: BillCalculator = {
      monthlyBills: (f) => stubBillCalculator.monthlyBills(f).map((b) => ({ ...b, exportCreditUsedZar: -1 })),
    }
    expect(() => year1Bills(neg, withBatt, pvOnly)).toThrow(/invalid bill/)
  })
})
