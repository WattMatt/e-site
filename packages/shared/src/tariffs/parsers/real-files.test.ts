/**
 * Whole-book sweep over the real sources. Skipped unless TARIFF_SOURCE_DIR is
 * set (CI never has the drive); run it by hand on the ingestion Mac:
 *   TARIFF_SOURCE_DIR="…/005. NERSA TARIFFS" pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/real-files.test.ts
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateTariff } from '../validators'
import { parseEskomWorkbook } from './eskom-xlsm'
import { parseProvinceWorkbook } from './province-xlsx'
import { parseRfdText } from './rfd-text'
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
    // Megaflex: network demand [R/kVA/m] on peak-window demand, network capacity on utilised capacity.
    const me = parsed.tariffs.find((t) => t.code === 'Me01N')
    expect(me?.charges.find((c) => c.component === 'network_demand')?.demandBasis).toBe('peak_window_md')
    expect(me?.charges.find((c) => c.component === 'network_capacity')?.demandBasis).toBe('utilised_capacity')
    const vat = parsed.tariffs.flatMap((t) => validateTariff(t)).filter((i) => i.code === 'vat_pair')
    expect(vat).toEqual([])
  }, 120_000)

  // The 33 municipal 2026/27 RfDs the City Power reader parsed were loaded to production from it. The
  // column reader (rfd-columns.ts) must never change what they produce: digests taken on the commit
  // before it (scripts/tariffs/rfd-coverage.ts --digests) must still match.
  it('parses the 33 already-loaded 2026/27 RfDs exactly as before the column reader', () => {
    const digests = JSON.parse(readFileSync(new URL('../__fixtures__/rfd-2026-27/city-power-reader.digests.json', import.meta.url), 'utf8')) as { file: string; sha256: string; digest: string }[]
    expect(digests).toHaveLength(33)
    for (const d of digests) {
      const path = join(DIR as string, '2026-27', 'MUNICIPAL', d.file)
      const bytes = readFileSync(path)
      expect(createHash('sha256').update(bytes).digest('hex'), d.file).toBe(d.sha256)
      const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      const parsed = parseRfdText(text, { fileSha256: d.sha256 })
      expect(createHash('sha256').update(JSON.stringify(parsed)).digest('hex'), d.file).toBe(d.digest)
    }
  }, 300_000)

  // Every 2026/27 RfD that yielded a tariff before the extended pass (164: the 33 above plus the
  // column reader's 131; all loaded to production). Digests taken on main at 84677997 with
  // scripts/tariffs/rfd-coverage.ts --digests. The extended pass must never change any of them.
  // The 6 files only the extended pass reads are pinned too, so a later change to them is deliberate.
  it.each([
    ['164 files parsed before the extended pass', 'all-readers-before-extended.digests.json', 164],
    ['6 files only the extended pass reads', 'extended-pass.digests.json', 6],
  ])('parses the %s exactly as pinned', (_what, fixtureFile, count) => {
    const digests = JSON.parse(readFileSync(new URL(`../__fixtures__/rfd-2026-27/${fixtureFile}`, import.meta.url), 'utf8')) as { file: string; sha256: string; digest: string }[]
    expect(digests).toHaveLength(count)
    const differ: string[] = []
    for (const d of digests) {
      const path = join(DIR as string, '2026-27', 'MUNICIPAL', d.file)
      const bytes = readFileSync(path)
      expect(createHash('sha256').update(bytes).digest('hex'), d.file).toBe(d.sha256)
      const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      const parsed = parseRfdText(text, { fileSha256: d.sha256 })
      if (createHash('sha256').update(JSON.stringify(parsed)).digest('hex') !== d.digest) differ.push(d.file)
    }
    expect(differ).toEqual([])
  }, 900_000)
})
