// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseMeterFile } from '@esite/shared/meter-data'
import { CommitBodySchema, CommitError, commitMeterFile } from './commit'
import { createFakeRepo } from './fake-repo'
import type { MeterFileRow } from './repo'

const enc = (s: string) => new TextEncoder().encode(s)
const pad = (n: number) => String(n).padStart(2, '0')
const A_TEXT = (() => {
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${40 + (i % 3)}`
  })
  return 'sep=,\r\n\r\ndate,p14\r\n' + rows.join('\r\n') + '\r\n'
})()
const B2_TEXT = [
  '"pnpscada.com", "30000001", "30000002"',
  '"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"',
  '10.0, 1.0, 10.05, 10.05, 2025-03-10, 00:30:00, Ok',
  '11.0, 1.0, 11.05, 11.05, 2025-03-10, 01:00:00, Ok',
  '12.0, 1.0, 12.04, 12.04, 2025-03-10, 01:30:00, Ok',
].join('\r\n')
const REGISTER_9COL = readFileSync(join(__dirname, '../../../../../../packages/shared/src/meter-data/__fixtures__/register/SITE YA_Consolidation_Summary.9col.csv'))

function setup(text: string | Uint8Array, name = 'SITE A, 1, TENANT-1, 100.csv') {
  const bytes = typeof text === 'string' ? enc(text) : new Uint8Array(text)
  // Real content hash and the exact <org>/<project>/<sha>.<ext> path: parseStoredFile re-verifies both.
  const sha = createHash('sha256').update(bytes).digest('hex')
  const path = `org1/p1/${sha}.csv`
  const file: MeterFileRow = { id: 'f1', organisation_id: 'org1', project_id: 'p1', sha256: sha, size_bytes: bytes.byteLength, storage_path: path, original_name: name, status: 'parsed' }
  const fake = createFakeRepo({ files: [file], raw: { [path]: bytes }, studyByProject: { p1: 's1' } })
  return { ...fake, ctx: { projectId: 'p1', orgId: 'org1', file } }
}
const NEW_TENANT = { new: { label: 'TENANT-1', kind: 'tenant' as const } }
const body = (extra: Record<string, unknown>) => CommitBodySchema.parse({ mode: 'series', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', meter: NEW_TENANT, identity: { resolution: 'none' }, ...extra })

describe('commitMeterFile: series', () => {
  it('creates the meter and channel, writes readings in chunks, verifies the count, links the study', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const out = await commitMeterFile(repo, ctx, body({}), { chunkSize: 20 })
    expect(state.meters).toEqual([expect.objectContaining({ label: 'TENANT-1', kind: 'tenant', serials: [] })])
    expect(state.channels).toEqual([expect.objectContaining({ source_column: 'p14', unit: 'kW', source_unit: 'kW', tz_convention: 'begin', is_primary: true, interval_min: 30, parser_version: '3a.1' })])
    expect(state.writeCalls.map((c) => c.n)).toEqual([20, 20, 8])
    expect(out).toMatchObject({ channels: [{ sourceColumn: 'p14', readings: 48 }] })
    expect(state.hashes).toHaveLength(1)
    expect(state.studyLinks).toEqual([{ studyId: 's1', meterId: state.meters[0].id }])
    expect(state.reports[0].accepted).toBe(true)
    expect(state.files[0].status).toBe('accepted')
    expect(state.audits.map((a) => a.verb)).toEqual(['meter_file_imported'])
  })

  it('is idempotent: committing twice leaves one channel with 48 readings', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const first = (await commitMeterFile(repo, ctx, body({}))) as { meterId: string }
    await commitMeterFile(repo, ctx, { mode: 'series', fileId: 'f1', meter: { existingMeterId: first.meterId }, identity: { resolution: 'none' } })
    expect(state.channels).toHaveLength(1)
    expect(state.readings.get(state.channels[0].id)?.size).toBe(48)
  })

  it('read-back mismatch is a 500 with the numbers', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.countOffset = -1
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toMatchObject({ status: 500, body: { error: 'readings_verification_failed', expected: 48, found: 47 } })
  })

  it('an identity conflict needs a resolution; override needs a reason', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const o = await parseMeterFile({ bytes: enc(A_TEXT), fileName: ctx.file.original_name })
    if (o.kind !== 'series') throw new Error('series expected')
    state.hashes.push({ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm9', file_id: 'f9', label: 'Vacant' })
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toMatchObject({ status: 409, body: { error: 'identity_conflict' } })
    await expect(commitMeterFile(repo, ctx, body({ identity: { resolution: 'override' } }))).rejects.toMatchObject({ status: 422, body: { error: 'override_needs_reason' } })
    await expect(commitMeterFile(repo, ctx, body({ identity: { resolution: 'override', reason: 'Checked against the SLD' } }))).resolves.toBeTruthy()
  })

  it('link on an identical body records the link and writes no readings', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const o = await parseMeterFile({ bytes: enc(A_TEXT), fileName: ctx.file.original_name })
    if (o.kind !== 'series') throw new Error('series expected')
    state.meters.push({ id: 'm9', organisation_id: 'org1', label: 'Vacant', site_label: null, serials: [], kind: 'vacant' })
    state.hashes.push({ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm9', file_id: 'f9', label: 'Vacant' })
    // commitMeterFile takes an already-validated body; the fake's ids are not UUIDs, so skip the schema here.
    const out = await commitMeterFile(repo, ctx, { mode: 'series', fileId: 'f1', meter: { existingMeterId: 'm9' }, identity: { resolution: 'link' } })
    expect(out).toMatchObject({ meterId: 'm9', channels: [] })
    expect(state.writeCalls).toEqual([])
    expect(state.hashes.some((h) => h.file_id === 'f1' && h.meter_id === 'm9')).toBe(true)
  })

  it('refuses unresolved parse errors, water meters, and a non-virtual multi-serial meter', async () => {
    const generic = setup('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n', 'g.csv')
    await expect(commitMeterFile(generic.repo, generic.ctx, body({}))).rejects.toMatchObject({ status: 422, body: { error: 'unresolved_errors' } })
    const a = setup(A_TEXT)
    await expect(commitMeterFile(a.repo, a.ctx, body({ meter: { new: { label: 'x', kind: 'water' } } }))).rejects.toMatchObject({ status: 422, body: { error: 'water_is_not_load' } })
    const b = setup(B2_TEXT, 'SITE RM, , E9001, .csv')
    await expect(commitMeterFile(b.repo, b.ctx, body({}))).rejects.toMatchObject({ status: 422, body: { error: 'multi_serial_meter_is_virtual' } })
    await expect(commitMeterFile(b.repo, b.ctx, body({ meter: { new: { label: 'E9001', kind: 'virtual' } } }))).resolves.toBeTruthy()
    expect(b.state.meters[0].serials).toEqual(['30000001', '30000002'])
  })

  it('generic file commits once the choices are supplied', async () => {
    const g = setup('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n13/02/2025 01:00,3\n', 'g.csv')
    const out = await commitMeterFile(g.repo, g.ctx, body({ options: { tsConvention: 'end', units: { kW: 'kW' } } }))
    expect(out).toMatchObject({ channels: [{ sourceColumn: 'kW', readings: 3 }] })
  })
  it('a unit choice the database cannot store (m3, unknown) is refused at the body, not by a CHECK', () => {
    expect(() => body({ options: { units: { kW: 'm3' } } })).toThrow()
    expect(() => body({ options: { units: { kW: 'unknown' } } })).toThrow()
  })
})

describe('commitMeterFile: a re-commit resolves to the meter this file already feeds', () => {
  it('committing `new` twice leaves one meter, one channel and the same readings', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const first = (await commitMeterFile(repo, ctx, body({}))) as { meterId: string }
    const second = (await commitMeterFile(repo, ctx, body({}))) as { meterId: string }
    expect(second.meterId).toBe(first.meterId)
    expect(state.meters).toHaveLength(1)
    expect(state.channels).toHaveLength(1)
    expect(state.readings.get(state.channels[0].id)?.size).toBe(48)
    expect(state.hashes).toHaveLength(1)
  })

  it('a re-commit asking for a NEW meter says it reused the recorded one (the new details are not applied)', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const first = await commitMeterFile(repo, ctx, body({}))
    expect(first).toMatchObject({ reusedMeter: false })
    const second = await commitMeterFile(repo, ctx, body({ meter: { new: { label: 'Renamed', kind: 'bulk' } } }))
    expect(second).toMatchObject({ reusedMeter: true, meterId: state.meters[0].id, meterLabel: 'TENANT-1' })
    expect(state.meters).toEqual([expect.objectContaining({ label: 'TENANT-1', kind: 'tenant' })])
  })

  it('a retry after a failed read-back check reuses the meter it created', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.countOffset = -1
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toMatchObject({ status: 500 })
    state.countOffset = 0
    await commitMeterFile(repo, ctx, body({}))
    expect(state.meters).toHaveLength(1)
    expect(state.channels).toHaveLength(1)
    expect(state.readings.get(state.channels[0].id)?.size).toBe(48)
  })

  it('a retry after a failure before any channel was written reuses the meter it created', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const upsert = repo.upsertChannel
    let calls = 0
    repo.upsertChannel = async (row) => {
      if (calls++ === 0) throw new Error('upsert channel: connection reset')
      return upsert(row)
    }
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toThrow('connection reset')
    await commitMeterFile(repo, ctx, body({}))
    expect(state.meters).toHaveLength(1)
    expect(state.channels).toHaveLength(1)
  })

  it('a re-commit with a changed timestamp convention REPLACES the channel readings (no stale rows, no 500)', async () => {
    const g = setup('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n13/02/2025 01:00,3\n', 'g.csv')
    await commitMeterFile(g.repo, g.ctx, body({ options: { tsConvention: 'end', units: { kW: 'kW' } } }))
    const before = [...(g.state.readings.get(g.state.channels[0].id)?.keys() ?? [])].sort()
    const out = await commitMeterFile(g.repo, g.ctx, body({ options: { tsConvention: 'begin', units: { kW: 'kW' } } }))
    expect(out).toMatchObject({ channels: [{ sourceColumn: 'kW', readings: 3 }] })
    expect(g.state.channels).toHaveLength(1)
    const after = [...(g.state.readings.get(g.state.channels[0].id)?.keys() ?? [])].sort()
    expect(after).toHaveLength(3)
    // begin -> each interval ends 30 min later than under 'end'
    expect(after).toEqual(before.map((t) => new Date(Date.parse(t) + 1_800_000).toISOString()))
  })

  it('a serial-bearing file re-committed with resolution none is not blocked by ITS OWN meter (no duplicate)', async () => {
    const b = setup(B2_TEXT, 'SITE RM, , E9001, .csv')
    const virt = { meter: { new: { label: 'E9001', kind: 'virtual' } } }
    const first = (await commitMeterFile(b.repo, b.ctx, body(virt))) as { meterId: string }
    const second = (await commitMeterFile(b.repo, b.ctx, body(virt))) as { meterId: string }
    expect(second.meterId).toBe(first.meterId)
    expect(b.state.meters).toHaveLength(1)
  })

  it('a serial-bearing file still conflicts with ANOTHER meter holding its serial', async () => {
    const b = setup(B2_TEXT, 'SITE RM, , E9001, .csv')
    b.state.meters.push({ id: 'm7', organisation_id: 'org1', label: 'Old', site_label: null, serials: ['30000001'], kind: 'tenant' })
    await expect(commitMeterFile(b.repo, b.ctx, body({ meter: { new: { label: 'E9001', kind: 'virtual' } } })))
      .rejects.toMatchObject({ status: 409, body: { error: 'identity_conflict' } })
  })

  it('naming a DIFFERENT existing meter for an imported file is a 409 naming the recorded meter', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const first = (await commitMeterFile(repo, ctx, body({}))) as { meterId: string }
    state.meters.push({ id: 'm9', organisation_id: 'org1', label: 'Other', site_label: null, serials: [], kind: 'tenant' })
    await expect(commitMeterFile(repo, ctx, { mode: 'series', fileId: 'f1', meter: { existingMeterId: 'm9' }, identity: { resolution: 'none' } }))
      .rejects.toMatchObject({ status: 409, body: { error: 'already_imported', meterId: first.meterId, label: 'TENANT-1' } })
    expect(state.channels.every((c) => c.meter_id === first.meterId)).toBe(true)
  })
})

// q14 first so a promoted q14 is written BEFORE the old primary p14; "Solar Total Power" repeats p14
// one interval later (a lagged channel, owner decision 3: never primary).
const A_LAG_TEXT = (() => {
  const p = [...Array(48).keys()].map((i) => 40 + (i % 7) + i * 0.25)
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${5 + (i % 3)},${p[i]},${i === 0 ? 1 : p[i - 1]}`
  })
  return 'sep=,\r\n\r\ndate,q14,p14,Solar Total Power\r\n' + rows.join('\r\n') + '\r\n'
})()

describe('commitMeterFile: the primary channel', () => {
  it('the parser defaults to p14 and never the lagged copy', async () => {
    const { repo, state, ctx } = setup(A_LAG_TEXT)
    await commitMeterFile(repo, ctx, body({}))
    expect(state.channels.filter((c) => c.is_primary).map((c) => c.source_column)).toEqual(['p14'])
  })
  it.each([
    ['a lagged channel', [{ sourceColumn: 'Solar Total Power', include: true, isPrimary: true }], 'lagged'],
    ['an excluded column', [{ sourceColumn: 'q14', include: false, isPrimary: true }], 'excluded'],
    ['an unknown column', [{ sourceColumn: 'nope', include: true, isPrimary: true }], 'unknown_column'],
  ])('an explicit primary that is %s is a 422', async (_label, channels, reason) => {
    const { repo, state, ctx } = setup(A_LAG_TEXT)
    await expect(commitMeterFile(repo, ctx, body({ channels }))).rejects.toMatchObject({ status: 422, body: { error: 'primary_not_eligible', reason } })
    expect(state.channels).toHaveLength(0)
  })
  it('moving the primary on a re-commit demotes the old one first (one primary per meter and file)', async () => {
    const { repo, state, ctx } = setup(A_LAG_TEXT)
    await commitMeterFile(repo, ctx, body({}))
    await commitMeterFile(repo, ctx, body({ channels: [{ sourceColumn: 'q14', include: true, isPrimary: true }] }))
    expect(state.channels.filter((c) => c.is_primary).map((c) => c.source_column)).toEqual(['q14'])
  })
  it('an old primary left out of the re-commit is demoted too', async () => {
    const { repo, state, ctx } = setup(A_LAG_TEXT)
    await commitMeterFile(repo, ctx, body({}))
    await commitMeterFile(repo, ctx, body({ channels: [{ sourceColumn: 'p14', include: false }, { sourceColumn: 'q14', include: true, isPrimary: true }] }))
    expect(state.channels.filter((c) => c.is_primary).map((c) => c.source_column)).toEqual(['q14'])
  })
  it('a stored channel the re-commit excludes keeps its row but loses its readings (the re-commit REPLACES)', async () => {
    const { repo, state, ctx } = setup(A_LAG_TEXT)
    await commitMeterFile(repo, ctx, body({}))
    const q = state.channels.find((c) => c.source_column === 'q14')
    expect(state.readings.get(q!.id)?.size).toBe(48)
    await commitMeterFile(repo, ctx, body({ channels: [{ sourceColumn: 'q14', include: false }] }))
    expect(state.channels.some((c) => c.id === q!.id)).toBe(true)
    expect(state.readings.get(q!.id)?.size ?? 0).toBe(0)
    expect(state.readings.get(state.channels.find((c) => c.source_column === 'p14')!.id)?.size).toBe(48)
  })
})

describe('commitMeterFile: register and skip', () => {
  it('imports a consolidation summary once', async () => {
    const { repo, state, ctx } = setup(REGISTER_9COL, 'SITE YA_Consolidation_Summary.9col.csv')
    const out = await commitMeterFile(repo, ctx, CommitBodySchema.parse({ mode: 'register', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', siteLabel: 'SITE YA' }))
    expect(out).toEqual({ registerRows: 26 })
    expect(state.register.filter((r) => r.match_method === 'llm')).toHaveLength(4)
    expect(state.register.every((r) => r.site_label === 'SITE YA' && r.source_file_id === 'f1' && r.organisation_id === 'org1')).toBe(true)
    await expect(commitMeterFile(repo, { ...ctx, file: { ...ctx.file, status: 'accepted' } }, CommitBodySchema.parse({ mode: 'register', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465' }))).rejects.toMatchObject({ status: 409 })
  })
  it('skip records the reason and keeps the raw file', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    expect(await commitMeterFile(repo, ctx, CommitBodySchema.parse({ mode: 'skip', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', reason: 'Duplicate of the bulk meter' }))).toEqual({ skipped: true })
    expect(state.filePatches.at(-1)?.patch).toEqual({ status: 'skipped', skip_reason: 'Duplicate of the bulk meter' })
    expect(state.raw[ctx.file.storage_path]).toBeDefined()
  })
  it('skip on an already-imported file is a 409 and changes nothing', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    await commitMeterFile(repo, ctx, body({}))
    const patches = state.filePatches.length
    await expect(commitMeterFile(repo, ctx, CommitBodySchema.parse({ mode: 'skip', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', reason: 'Changed my mind' })))
      .rejects.toMatchObject({ status: 409, body: { error: 'already_imported' } })
    expect(state.files[0].status).toBe('accepted')
    expect(state.filePatches).toHaveLength(patches)
  })
  it('skip on a PARTIALLY committed file (meter bound, never accepted) is a 409', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.countOffset = -1
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toMatchObject({ status: 500 })
    expect(state.files[0].status).not.toBe('accepted')
    await expect(commitMeterFile(repo, ctx, CommitBodySchema.parse({ mode: 'skip', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', reason: 'Changed my mind' })))
      .rejects.toMatchObject({ status: 409, body: { error: 'already_imported' } })
    expect(state.files[0].status).not.toBe('skipped')
  })
})

describe('commitMeterFile: a failed re-commit never leaves an accepted file with partial readings', () => {
  it('writeReadings throwing after the clear takes the file out of accepted', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    await commitMeterFile(repo, ctx, body({}))
    expect(state.files[0].status).toBe('accepted')
    repo.writeReadings = async () => { throw new Error('write readings: connection reset') }
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toThrow('connection reset')
    expect(state.readings.get(state.channels[0].id)?.size ?? 0).toBe(0)   // cleared, nothing rewritten
    expect(state.files[0].status).toBe('parsed')
  })
})

describe('commitMeterFile: a tenant chosen at import is the tenant the load uses (LS-02)', () => {
  const NODE = '3b0f7c1e-2a4d-4c8e-9f10-1a2b3c4d5e6f'
  const withNode = (kind = 'tenant') => body({ meter: { new: { label: 'TENANT-1', kind, nodeId: NODE } } })

  it('assigns the new meter to the tenant in tenant_load_basis (metered, weight 1)', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.tenantNodes = { p1: [NODE] }
    const out = await commitMeterFile(repo, ctx, withNode())
    const meterId = state.meters[0].id
    expect(state.basis).toEqual([expect.objectContaining({ studyId: 's1', nodeId: NODE, source: 'metered', meters: [{ meter_id: meterId, weight: 1 }] })])
    expect(out).toMatchObject({ tenantAssignment: 'assigned' })
  })

  it('appends to a tenant that already has metered meters, keeping theirs', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.tenantNodes = { p1: [NODE] }
    state.basis = [{ studyId: 's1', nodeId: NODE, source: 'metered', meters: [{ meter_id: 'mOld', weight: 0.5 }], updated_at: 'v1' }]
    await commitMeterFile(repo, ctx, withNode())
    expect(state.basis).toEqual([expect.objectContaining({ source: 'metered', meters: [{ meter_id: 'mOld', weight: 0.5 }, { meter_id: state.meters[0].id, weight: 1 }] })])
  })

  it('never overturns a deliberate synthesised or excluded tenant', async () => {
    for (const source of ['synthesised', 'excluded']) {
      const { repo, state, ctx } = setup(A_TEXT)
      state.tenantNodes = { p1: [NODE] }
      state.basis = [{ studyId: 's1', nodeId: NODE, source, meters: [{ meter_id: 'mOld', weight: 1 }], updated_at: 'v1' }]
      const out = await commitMeterFile(repo, ctx, withNode())
      expect(state.basis).toEqual([expect.objectContaining({ source, meters: [{ meter_id: 'mOld', weight: 1 }], updated_at: 'v1' })])
      expect(out).toMatchObject({ tenantAssignment: 'needs_review' })
    }
  })

  it('a retry after a partial failure still assigns the tenant', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.tenantNodes = { p1: [NODE] }
    state.countOffset = -1
    await expect(commitMeterFile(repo, ctx, withNode())).rejects.toMatchObject({ status: 500 })
    expect(state.basis).toEqual([])
    state.countOffset = 0
    const out = await commitMeterFile(repo, ctx, withNode())
    expect(out).toMatchObject({ reusedMeter: true, tenantAssignment: 'assigned' })
    expect(state.basis).toEqual([expect.objectContaining({ nodeId: NODE, meters: [{ meter_id: state.meters[0].id, weight: 1 }] })])
  })

  it('a meter kind that never carries a tenant load (bulk) is not assigned', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.tenantNodes = { p1: [NODE] }
    const out = await commitMeterFile(repo, ctx, withNode('bulk'))
    expect(state.basis).toEqual([])
    expect(out).toMatchObject({ tenantAssignment: null })
  })

  it('refuses a tenant that is not in this project before writing anything', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    await expect(commitMeterFile(repo, ctx, withNode())).rejects.toMatchObject({ status: 422, body: { error: 'tenant_not_in_project' } })
    expect(state.meters).toEqual([])
    expect(state.basis).toEqual([])
  })

  it('with no study row yet, the meter imports and nothing is assigned', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.tenantNodes = { p1: [NODE] }
    state.studyByProject = {}
    const out = await commitMeterFile(repo, ctx, withNode())
    expect(state.meters).toHaveLength(1)
    expect(state.basis).toEqual([])
    expect(out).toMatchObject({ tenantAssignment: null })
  })
})
