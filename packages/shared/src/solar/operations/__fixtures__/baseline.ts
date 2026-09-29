import type { OpsBaseline } from '../baseline'

/** 100 kWp; 1,000 kWh in every TMY month; PV only 10:00–13:59 SAST, flat. */
export const flatBaseline = (over: Partial<OpsBaseline> = {}): OpsBaseline => ({
  version: 1, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000),
  diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 14 ? 5 : 0))),
  ghiKwhM2: new Array(12).fill(200),
  ...over,
})
