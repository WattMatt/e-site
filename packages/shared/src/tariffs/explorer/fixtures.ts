/** Test builders for the explorer units (not exported from the barrel). */
import type { Charge, Tariff } from '../types'

export function ch(p: Partial<Charge> & Pick<Charge, 'component' | 'unit' | 'amountExclVat'>): Charge {
  return {
    season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null, blockBasis: null,
    demandBasis: null, vatRate: 0.15, vatBasis: 'stated_excl', unitInferred: false, inferenceReason: null,
    sourceLocator: {}, extractionMethod: 'parser', ...p,
  }
}

export function tariff(name: string, charges: Charge[], p: Partial<Tariff> = {}): Tariff {
  return {
    code: null, name, family: null, category: 'commercial', metering: 'conventional', structure: 'tou',
    voltageBand: null, phase: null, transmissionZone: null, localAuthority: false, minAmps: null, maxAmps: null,
    minKva: null, maxKva: null, isLegacy: false, notes: null, charges, exportTariffCode: null, sourceLocator: {}, ...p,
  }
}
