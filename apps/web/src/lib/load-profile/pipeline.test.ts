// @vitest-environment node
// Server code: under jsdom, crypto.subtle.digest rejects a Node-realm Uint8Array on CI (cross-realm instanceof).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '@esite/shared/meter-data'
import { buildMeterRows, parseStoredFile } from './pipeline'

const P = '11111111-2222-3333-4444-555555555555'
const CORPUS = join(__dirname, '../../../../../packages/shared/src/meter-data/__fixtures__/corpus')
const bytesOf = (name: string) => new Uint8Array(readFileSync(join(CORPUS, name)))

async function stored(name: string) {
  const bytes = bytesOf(name)
  const sha = await sha256Hex(bytes)
  const path = `${P}/${sha}.csv`
  return { bytes, path, download: async (p: string) => (p === path ? bytes : null) }
}

describe('parseStoredFile', () => {
  it('re-parses the stored file and plans it (format C: energy → kW, paired kVA)', async () => {
    const f = await stored('SITE TZ, , 01A TENANT-95, .csv')
    const r = await parseStoredFile({ download: f.download, projectId: P, path: f.path, fileName: 'SITE TZ, , 01A TENANT-95, .csv' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.parts).toHaveLength(1)
    const plan = r.parts[0].plan
    expect(plan.status).toBe('ok')
    if (plan.status !== 'ok') return
    expect(plan.candidates.find((c) => c.defaultSelected)).toMatchObject({ column: 'P1 (kWh)', kvaColumn: 'S (kVAh)', conversion: 'kWh per 30 min × 2 → average kW' })
  })
  it('refuses a path of another project and bytes that do not hash to the path', async () => {
    const f = await stored('SITE TZ, , 01A TENANT-95, .csv')
    const other = f.path.replace(P, '99999999-2222-3333-4444-555555555555')
    expect(await parseStoredFile({ download: f.download, projectId: P, path: other, fileName: 'x.csv' })).toEqual({ ok: false, error: 'That file does not belong to this project.' })
    const tampered = async () => new Uint8Array([1, 2, 3])
    expect(await parseStoredFile({ download: tampered, projectId: P, path: f.path, fileName: 'x.csv' })).toEqual({ ok: false, error: 'The stored file does not match its upload. Upload it again.' })
  })
})

describe('buildMeterRows', () => {
  it('builds a contiguous stored channel with kW converted and the kVA channel on the same grid', async () => {
    const name = 'SITE TZ, , 01A TENANT-95, .csv'
    const f = await stored(name)
    const r = await buildMeterRows({ download: f.download, projectId: P, path: f.path, fileName: name, sheet: null, selections: [{ column: 'P1 (kWh)', label: 'Shop 01A', withKva: true, role: 'tenant' as const }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.rows[0]
    expect(row).toMatchObject({ kind: 'meter', label: 'Shop 01A', format: 'C', source_column: 'P1 (kWh)', kva_column: 'S (kVAh)', interval_min: 30 })
    expect(row.values.length).toBe(row.quality.length)
    expect(row.kva_values!.length).toBe(row.values.length)
    // First data line: 2025-03-10 00:30, P1 2.93 kWh in 30 min → 5.86 kW (ends 00:30 SAST = 2025-03-09T22:30Z).
    expect(row.first_ts_end).toBe('2025-03-09T22:30:00.000Z')
    expect(row.values[0]).toBeCloseTo(5.86, 6)
    expect(row.quality_report.slots).toBe(row.values.length)
  })
  it('refuses a channel that is not active-power import, naming why', async () => {
    const name = 'SITE TZ, , 01A TENANT-95, .csv'
    const f = await stored(name)
    const r = await buildMeterRows({ download: f.download, projectId: P, path: f.path, fileName: name, sheet: null, selections: [{ column: 'P2 (kWh)', label: '', withKva: false, role: 'tenant' as const }] })
    expect(r).toEqual({ ok: false, error: '"P2 (kWh)" cannot be imported as load: Export channel: not load.' })
  })
})
