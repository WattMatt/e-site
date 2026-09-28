// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseMeterFile, type SeriesOutcome } from '@esite/shared/meter-data'
import { createFakeRepo } from './fake-repo'
import { buildReviewModel, fileParsePatch, fileStatusFor, lookupIdentity } from './review'

const enc = (s: string) => new TextEncoder().encode(s)
const pad = (n: number) => String(n).padStart(2, '0')
function aFile(value = 50): string {
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${value}`
  })
  return 'sep=,\r\n\r\ndate,p14\r\n' + rows.join('\r\n') + '\r\n'
}
function bFile(serials: string[]): string {
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 30) + i * 1_800_000)
    return `10.0, 1.0, 10.05, 10.05, ${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00, Ok`
  })
  return [`"pnpscada.com", ${serials.map((s) => `"${s}"`).join(', ')}`, '"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"', ...rows].join('\r\n')
}
async function series(text: string, name: string): Promise<SeriesOutcome> {
  const o = await parseMeterFile({ bytes: enc(text), fileName: name })
  if (o.kind !== 'series') throw new Error(o.kind)
  return o
}

describe('lookupIdentity', () => {
  it('no conflicts for a new file', async () => {
    const { repo } = createFakeRepo()
    const id = await lookupIdentity(repo, 'org1', await series(aFile(), 'SITE A, 1, TENANT-1, 100.csv'))
    expect(id).toMatchObject({ conflicts: [], blocking: false })
  })
  it('same body elsewhere in the org blocks, naming the meter and site', async () => {
    const o = await series(aFile(), 'SITE A, 1, TENANT-1, 100.csv')
    const { repo } = createFakeRepo({ hashes: [{ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm9', file_id: 'f9', label: 'Vacant', siteLabel: 'SITE FV' }] })
    const id = await lookupIdentity(repo, 'org1', o)
    expect(id.blocking).toBe(true)
    expect(id.conflicts).toEqual([{ kind: 'same_body', meterId: 'm9', message: 'Same data as Vacant at SITE FV.' }])
    expect((await lookupIdentity(repo, 'org1', o, 'f9')).blocking).toBe(false)   // the file itself, re-parsed
  })
  it('PnP: serial already a meter; register says another mall; filename serial differs', async () => {
    const o = await series(bFile(['30000001']), 'SITE SG, , 30999999_DB-26, .csv')
    const { repo } = createFakeRepo({
      meters: [{ id: 'm1', organisation_id: 'org1', label: 'Local Main', site_label: 'SITE MR', serials: ['30000001'], kind: 'tenant' }],
      register: [{ organisation_id: 'org1', kind: 'download_log', serial: '30000001', mall_name: 'SITE PD', tenant_name: 'TENANT-E001' }],
    })
    const id = await lookupIdentity(repo, 'org1', o)
    expect(id.conflicts.map((c) => c.kind)).toEqual(['same_serial', 'serial_other_mall', 'filename_serial_mismatch'])
  })
  it('the meter this file already feeds is not a same_serial conflict of the file itself (re-parse / re-commit)', async () => {
    const o = await series(bFile(['30000001']), 'SITE SG, , 30000001_DB-26, .csv')
    const { repo } = createFakeRepo({
      meters: [
        { id: 'm1', organisation_id: 'org1', label: 'DB-26', site_label: 'SITE SG', serials: ['30000001'], kind: 'tenant' },
        { id: 'm2', organisation_id: 'org1', label: 'Other', site_label: null, serials: ['30000001'], kind: 'tenant' },
      ],
      hashes: [{ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm1', file_id: 'f1' }],
    })
    const id = await lookupIdentity(repo, 'org1', o, 'f1')
    expect(id.conflicts.map((c) => [c.kind, c.meterId])).toEqual([['same_serial', 'm2']])
  })
})

describe('file status and patch', () => {
  it('series without errors → parsed; hard error → skipped with the code; choice errors stay parsed', async () => {
    expect(fileStatusFor(await series(aFile(), 'x.csv'))).toEqual({ status: 'parsed', skip_reason: null })
    const empty = await parseMeterFile({ bytes: enc('sep=,\r\n\r\n'), fileName: 'x.csv' })
    expect(fileStatusFor(empty)).toEqual({ status: 'skipped', skip_reason: 'empty_file' })
    const generic = await parseMeterFile({ bytes: enc('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n'), fileName: 'g.csv' })
    expect(fileStatusFor(generic)).toEqual({ status: 'parsed', skip_reason: null })
  })
  it('patch carries the detected facts', async () => {
    const p = fileParsePatch(await series(bFile(['30000001', '30000002']), 'x.csv'))
    expect(p).toMatchObject({ detected_format: 'B', ts_convention: 'end', row_order: 'ascending', source_serials: ['30000001', '30000002'], status: 'parsed' })
    expect(p.body_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildReviewModel', () => {
  it('series: channels, primary default, 48-row preview, identity, canAccept', async () => {
    const o = await series(aFile(), 'SITE A, 1, TENANT-1, 100.csv')
    const m = buildReviewModel({ fileId: 'f1', fileName: 'SITE A, 1, TENANT-1, 100.csv', sheetName: null, reportId: 'r1', outcome: o, identity: { sourceSerials: [], filenameSerial: null, conflicts: [], blocking: false }, registerHints: [] })
    expect(m).toMatchObject({ outcome: 'series', format: 'A', canAccept: true, choicesNeeded: [], blockingErrors: [] })
    expect(m.channels).toEqual([expect.objectContaining({ column: 'p14', isPrimaryDefault: true, storedUnit: 'kW', suggestedUnit: null })])
    expect(m.preview).toHaveLength(48)
    expect(m.preview[0]).toEqual({ tsEnd: '2025-03-09T22:30:00.000Z', value: 50, quality: 0 })
    expect(m.hints).toMatchObject({ site: 'SITE A', shopNo: '1', label: 'TENANT-1', areaM2: 100 })
  })
  it('generic without choices: not acceptable, lists the choices', async () => {
    const o = await parseMeterFile({ bytes: enc('Time,Import (kW)\n01/02/2025 00:30,1\n01/02/2025 01:00,2\n'), fileName: 'g.csv' })
    const m = buildReviewModel({ fileId: 'f1', fileName: 'g.csv', sheetName: null, reportId: 'r1', outcome: o, identity: null, registerHints: [] })
    expect(m.canAccept).toBe(false)
    expect(m.choicesNeeded.sort()).toEqual(['ambiguous_date_order', 'convention_required', 'unknown_unit'])
    expect(m.channels[0].suggestedUnit).toBe('kW')
  })
})
