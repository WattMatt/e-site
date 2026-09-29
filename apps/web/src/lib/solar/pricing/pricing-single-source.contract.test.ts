// @vitest-environment node
/**
 * I-1: the Tariff tab bill check and Yield & Financials must price a study through ONE loader
 * (loadStudyPricing → resolveStudyPricing), or they drift apart again. This reads the two entry
 * points' SOURCE and refuses any that builds a tariff itself.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const ENTRY_POINTS = ['tariff/effective-tariff.ts', 'cases/tariff.ts']
/** Anything that turns rows into a priced tariff; only the loader + the shared resolver may. */
const BUILDERS = ['tariffFromRows', 'overrideToTariff', 'manualExportTariff', 'overrideChargeFromDb', "from('charge')", "from('tariff_override_charges')", "from('study_export_rates')", "from('sseg_rule')"]

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('pricing has one source', () => {
  for (const f of ENTRY_POINTS) {
    const src = strip(readFileSync(join(ROOT, f), 'utf8'))
    it(`${f} loads pricing through loadStudyPricing`, () => {
      expect(src).toMatch(/from '\.\.\/pricing\/load-study-pricing'/)
      expect(src).toMatch(/loadStudyPricing\(/)
    })
    it(`${f} builds no tariff of its own`, () => {
      expect(BUILDERS.filter((b) => src.includes(b))).toEqual([])
    })
  }
})
