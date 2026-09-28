/**
 * Whole-book sweep over the real sources. Skipped unless TARIFF_SOURCE_DIR is
 * set (CI never has the drive); run it by hand on the ingestion Mac:
 *   TARIFF_SOURCE_DIR="…/005. NERSA TARIFFS" pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/real-files.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateTariff } from '../validators'
import { parseEskomWorkbook } from './eskom-xlsm'
import { parseProvinceWorkbook } from './province-xlsx'
import { loadWorkbookGrids } from './xlsx-load'

const DIR = process.env.TARIFF_SOURCE_DIR
const PROVINCES = [
  'Eastern-Cape-Province', 'Free-State-Province', 'Gauteng-Province', 'Kwa-Zulu-Natal-Province', 'Limpopo-Province',
  'Mpumalanga-Province', 'North-West-Province', 'Northern-Cape-Province', 'Western-Cape-Province1',
]

describe.skipIf(!DIR)('real source books', () => {
  it('parses all 177 province sheets with no 100x energy errors left unflagged', async () => {
    let sheets = 0
    let charges = 0
    for (const p of PROVINCES) {
      const grids = await loadWorkbookGrids(readFileSync(join(DIR as string, '2025', `${p}.xlsx`)))
      const parsed = parseProvinceWorkbook(grids, { fileSha256: p })
      sheets += parsed.length
      for (const s of parsed) {
        for (const t of s.tariffs) {
          for (const c of t.charges) {
            charges++
            // An energy value under 20 left in c/kWh is exactly the old seed's 628-row defect.
            if (c.component === 'energy' && c.unit === 'c_per_kWh' && c.amountExclVat > 0) expect(c.amountExclVat, `${s.sheet} / ${t.name}`).toBeGreaterThanOrEqual(20)
          }
        }
      }
    }
    expect(sheets).toBe(177)
    console.log(`province sweep: ${sheets} sheets, ${charges} charges`)
    expect(charges).toBeGreaterThan(5000)
  }, 120_000)

  it.each([
    ['2025/26', 'ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm'],
    ['2026/27', '2026-27/ESKOM/Eskom-tariffs-1-April-2026-Public.xlsm'],
  ])('parses the Eskom %s workbook: Homeflex, Gen-offset, loss factors, no VAT-pair failures', async (_fy, file) => {
    const parsed = parseEskomWorkbook(await loadWorkbookGrids(readFileSync(join(DIR as string, file))), { fileSha256: file })
    const hf1 = parsed.tariffs.find((t) => t.code === 'HF101N')
    expect(hf1?.charges.filter((c) => c.component === 'energy')).toHaveLength(6)
    expect(hf1?.exportTariffCode).toBe('GOHF101N')
    expect(parsed.lossFactors.filter((f) => f.kind === 'tx')).toHaveLength(4)
    const vat = parsed.tariffs.flatMap((t) => validateTariff(t)).filter((i) => i.code === 'vat_pair')
    expect(vat).toEqual([])
  }, 120_000)
})
