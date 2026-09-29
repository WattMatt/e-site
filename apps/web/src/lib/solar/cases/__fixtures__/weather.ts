import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const DIR = resolve(__dirname, '../../../../../../../packages/shared/src/services/solar/__fixtures__/pvgis')

/** The verbatim PVGIS 5.2 TMY CSV response for Johannesburg (sha-pinned in 4a's pvgis.ts). Test-only; no network. */
export function jhbTmyCsv(): string {
  return gunzipSync(readFileSync(resolve(DIR, 'tmy_jhb.csv.gz'))).toString('utf8')
}
