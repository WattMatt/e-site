#!/usr/bin/env node
// Fetches the PVGIS 5.2 fixtures for the solar engine validation (engine spec §3.7, D-19).
//
//   node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs               # TMY weather → __fixtures__/pvgis/*.csv.gz
//   node packages/shared/scripts/solar/fetch-pvgis-fixtures.mjs --references  # also recompute the reference yields (~10 min)
//
// Each TMY response's SHA-256 must equal the value pinned in __fixtures__/pvgis.ts; the script
// refuses to write a file that differs (PVGIS republished its data — re-validate before re-pinning).
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'https://re.jrc.ec.europa.eu/api/v5_2'
const SITES = {
  jhb: { lat: -26.2, lon: 28.05, sha: '39dfa9292884b4e52df79ecaef77e7efe4d7b8a1bd4434b1ba7b3ddd75714d6d' },
  pta: { lat: -25.75, lon: 28.19, sha: '51e1301a1cf40c22f025b9d3c4961a9c93a4439526bfc91c708cb0a0a657e4c0' },
  cpt: { lat: -33.92, lon: 18.42, sha: '2051ba13d488ba27bd08408e692906d4d9e5984e2bf0d8f020233e067dfc0f29' },
  dbn: { lat: -29.86, lon: 31.02, sha: '3c676fa3273b00a146c54ae1681e44730c4308e0571ee77295554b6c73566eee' },
  upt: { lat: -28.45, lon: 21.26, sha: 'd86320b8c1688f26a13a60ee2973cb71c668e9282f0b96bbf237bbef80bf57d8' },
}
// [key, tilt, PVGIS aspect (0 = south, 90 = west, −90 = east, 180 = north)]
const CASES = [['n30', 30, 180], ['n15', 15, 180], ['e10', 10, -90], ['w10', 10, 90]]
const COMMON = 'peakpower=1&loss=10.05&mountingplace=free&pvtechchoice=crystSi&raddatabase=PVGIS-SARAH2&usehorizon=1&outputformat=json'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/services/solar/__fixtures__/pvgis')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, as = 'text') {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return as === 'json' ? res.json() : res.text()
      console.error(`HTTP ${res.status} (attempt ${attempt}) ${url}`)
    } catch (e) {
      console.error(`${e.message} (attempt ${attempt}) ${url}`)
    }
    await sleep(3000)
  }
  throw new Error(`gave up on ${url}`)
}

mkdirSync(outDir, { recursive: true })
const monthsBySite = {}
for (const [key, s] of Object.entries(SITES)) {
  const text = await get(`${API}/tmy?lat=${s.lat}&lon=${s.lon}&outputformat=csv`)
  const sha = createHash('sha256').update(text, 'utf8').digest('hex')
  if (sha !== s.sha) throw new Error(`${key}: TMY SHA-256 ${sha} ≠ pinned ${s.sha}. PVGIS data changed — stop and re-validate.`)
  writeFileSync(join(outDir, `tmy_${key}.csv.gz`), gzipSync(Buffer.from(text, 'utf8'), { level: 9 }))
  const lines = text.split(/\r?\n/)
  const i0 = lines.findIndex((l) => l.startsWith('month,year'))
  monthsBySite[key] = Object.fromEntries(lines.slice(i0 + 1, i0 + 13).map((l) => l.split(',').map(Number)))
  console.log(`${key}: ok ${sha}`)
}

if (process.argv.includes('--references')) {
  const out = {}
  for (const [key, s] of Object.entries(SITES)) {
    out[key] = {}
    const years = [...new Set(Object.values(monthsBySite[key]))]
    for (const [c, tilt, aspect] of CASES) {
      const pvcalc = await get(`${API}/PVcalc?lat=${s.lat}&lon=${s.lon}&angle=${tilt}&aspect=${aspect}&${COMMON}`, 'json')
      let tmyKwh = 0
      for (const y of years) {
        const sc = await get(
          `${API}/seriescalc?lat=${s.lat}&lon=${s.lon}&startyear=${y}&endyear=${y}&pvcalculation=1&angle=${tilt}&aspect=${aspect}&${COMMON}`,
          'json',
        )
        for (const r of sc.outputs.hourly) {
          const m = +r.time.slice(4, 6)
          const d = +r.time.slice(6, 8)
          if (monthsBySite[key][m] !== y || (m === 2 && d === 29)) continue
          tmyKwh += r.P / 1000
        }
        await sleep(500)
      }
      out[key][c] = { pvcalcEy: pvcalc.outputs.totals.fixed.E_y, tmyMonths: Math.round(tmyKwh * 100) / 100 }
      console.log(key, c, out[key][c])
    }
  }
  console.log(JSON.stringify(out, null, 2))
}
