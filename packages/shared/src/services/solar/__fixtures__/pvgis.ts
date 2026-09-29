/**
 * PVGIS 5.2 fixtures for the engine validation (spec §3.7, D-19 — public references only).
 * Test-only: excluded from the package type-check (it reads files with node:fs / node:zlib).
 *
 * Weather: the verbatim `tmy` CSV response per site, gzipped. Fetched 2026-09-28 with
 *   https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=<lat>&lon=<lon>&outputformat=csv
 * The SHA-256 of each UNCOMPRESSED response is pinned below; the fixture loader refuses a file
 * whose content does not match (PVGIS republished data or the file was edited).
 * Data © European Union (JRC PVGIS), reusable with acknowledgement (Commission Decision 2011/833/EU).
 *
 * Regenerate / re-check: `node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs`.
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parsePvgisTmyCsv } from '../weather/pvgis-tmy'
import { tmyToReferenceYear, type WeatherYear } from '../weather/reference-year'

export type SiteKey = 'jhb' | 'pta' | 'cpt' | 'dbn' | 'upt'
export type OrientationKey = 'n30' | 'n15' | 'ew10'

export const SITES: Record<SiteKey, { name: string; lat: number; lon: number; tmySha256: string }> = {
  jhb: { name: 'Johannesburg', lat: -26.2, lon: 28.05, tmySha256: '39dfa9292884b4e52df79ecaef77e7efe4d7b8a1bd4434b1ba7b3ddd75714d6d' },
  pta: { name: 'Pretoria', lat: -25.75, lon: 28.19, tmySha256: '51e1301a1cf40c22f025b9d3c4961a9c93a4439526bfc91c708cb0a0a657e4c0' },
  cpt: { name: 'Cape Town', lat: -33.92, lon: 18.42, tmySha256: '2051ba13d488ba27bd08408e692906d4d9e5984e2bf0d8f020233e067dfc0f29' },
  dbn: { name: 'Durban', lat: -29.86, lon: 31.02, tmySha256: '3c676fa3273b00a146c54ae1681e44730c4308e0571ee77295554b6c73566eee' },
  upt: { name: 'Upington', lat: -28.45, lon: 21.26, tmySha256: 'd86320b8c1688f26a13a60ee2973cb71c668e9282f0b96bbf237bbef80bf57d8' },
}

/**
 * Loss inputs used IDENTICALLY on both sides. Engine: the spec §7 defaults with shading 0
 * (PVGIS models the horizon itself) and a flat 97.5 % inverter. PVGIS `loss` = 1 − Π(1 − l_i)
 * of the same chain = 1 − 0.98·0.99·0.985·0.985·0.975·0.99·0.99 = 10.05 %.
 */
export const PVGIS_LOSS_PERCENT = 10.05

/**
 * PRIMARY reference (the ±3 % gate): PVGIS's own PV model (`seriescalc`, `pvcalculation=1` — the
 * same model PVcalc runs) summed over exactly the months the TMY drew from each source year,
 * 29 February excluded. Same weather on both sides, so only the MODEL is compared.
 *   https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=<lat>&lon=<lon>&startyear=<y>&endyear=<y>
 *     &pvcalculation=1&peakpower=1&loss=10.05&angle=<tilt>&aspect=<aspect>&mountingplace=free
 *     &pvtechchoice=crystSi&raddatabase=PVGIS-SARAH2&usehorizon=1&outputformat=json
 * PVGIS aspect: 0 = south, 90 = west, −90 = east, 180 = north. East–west = mean of the two halves.
 * kWh/kWp/yr.
 */
export const PVGIS_TMY_MONTHS_REFERENCE: Record<SiteKey, Record<OrientationKey, number>> = {
  jhb: { n30: 1821.02, n15: 1767.87, ew10: (1608.16 + 1602.28) / 2 },
  pta: { n30: 1756.05, n15: 1716.61, ew10: (1575.45 + 1576.59) / 2 },
  cpt: { n30: 1732.35, n15: 1692.9, ew10: (1544.16 + 1551.38) / 2 },
  dbn: { n30: 1466.71, n15: 1424.39, ew10: (1286.91 + 1306.85) / 2 },
  upt: { n30: 1939.11, n15: 1887.79, ew10: (1719.92 + 1714.05) / 2 },
}

/**
 * PVcalc long-term E_y (2005–2020 SARAH2 mean), fetched 2026-09-28:
 *   https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat=<lat>&lon=<lon>&peakpower=1&loss=10.05&angle=<tilt>
 *     &aspect=<aspect>&mountingplace=free&pvtechchoice=crystSi&raddatabase=PVGIS-SARAH2&usehorizon=1
 *     &outputformat=json          → outputs.totals.fixed.E_y
 * These differ from the TMY-months reference by the TMY's own representativeness (Durban's TMY
 * GHI is 3.7 % below its 16-year mean), so they are checked at ±5 %, not gated at ±3 %.
 */
export const PVCALC_LONG_TERM_EY: Record<SiteKey, Record<OrientationKey, number>> = {
  jhb: { n30: 1835.61, n15: 1786.17, ew10: (1635.11 + 1617.99) / 2 },
  pta: { n30: 1815.17, n15: 1767.89, ew10: (1613 + 1615.7) / 2 },
  cpt: { n30: 1761.11, n15: 1716.09, ew10: (1553.25 + 1573.65) / 2 },
  dbn: { n30: 1558.08, n15: 1505.02, ew10: (1354.51 + 1365.43) / 2 },
  upt: { n30: 1979.65, n15: 1925.61, ew10: (1752.3 + 1745.91) / 2 },
}

/** WM Solar's static curve: ≈ 2,346 kWh/kWp regardless of site or orientation. */
export const WM_STATIC_SPECIFIC_YIELD = 2346

export function loadTmyCsv(site: SiteKey): string {
  const gz = readFileSync(new URL(`./pvgis/tmy_${site}.csv.gz`, import.meta.url))
  const text = gunzipSync(gz).toString('utf8')
  const sha = createHash('sha256').update(text, 'utf8').digest('hex')
  if (sha !== SITES[site].tmySha256) throw new Error(`fixture tmy_${site}.csv.gz does not match its pinned SHA-256 (${sha})`)
  return text
}

export function loadWeather(site: SiteKey): WeatherYear {
  return tmyToReferenceYear(parsePvgisTmyCsv(loadTmyCsv(site)))
}
