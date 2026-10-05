// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMeterFile } from '@esite/shared/meter-data'
import { fakeSupabase } from '@/test/fake-supabase'
import { ARCHIVE_PROJECT_DESCRIPTION, commitBody, findOrCreateProject } from './apply'
import { planArchive, type LoadDecision } from './plan'

const CORPUS = join(__dirname, '../../../../../../packages/shared/src/meter-data/__fixtures__/corpus')
const ORG = '00000000-0000-0000-0000-0000000000aa'
const USER = '00000000-0000-0000-0000-0000000000bb'

describe('commitBody', () => {
  it('lists every channel of the file and includes only the chosen ones (unlisted columns would default to included)', async () => {
    const name = 'SITE TZ, , 01A TENANT-95, .csv'
    const f = { site: 'SITE TZ', fileName: name, outcome: await parseMeterFile({ bytes: new Uint8Array(readFileSync(join(CORPUS, name))), fileName: name }) }
    const d = planArchive([f], new Map())[0] as LoadDecision
    const body = commitBody('11111111-1111-1111-1111-111111111111', d, f)
    if (body.mode !== 'series') throw new Error('series body expected')
    expect(body.channels!.filter((c) => c.include).map((c) => c.sourceColumn)).toEqual(['P1 (kWh)', 'S (kVAh)'])
    expect(body.channels!.filter((c) => c.isPrimary).map((c) => c.sourceColumn)).toEqual(['P1 (kWh)'])
    expect(body.channels!.length).toBe(f.outcome.kind === 'series' ? f.outcome.channels.length : -1)
    expect(body.meter).toEqual({ new: { label: '01A TENANT-95', kind: 'tenant', siteLabel: 'SITE TZ', shopNo: d.shopNo, areaM2: null, areaSource: null } })
    expect(body.identity).toEqual({ resolution: 'none' })
    const linked = commitBody('11111111-1111-1111-1111-111111111111', d, f, '22222222-2222-2222-2222-222222222222')
    expect(linked).toMatchObject({ meter: { existingMeterId: '22222222-2222-2222-2222-222222222222' }, identity: { resolution: 'link' } })
  })
})

describe('findOrCreateProject', () => {
  it('reuses a project of that name in the org', async () => {
    const { client, calls } = fakeSupabase({ tables: { 'projects.projects': [{ id: 'p1', organisation_id: ORG, name: 'KURUMAN MALL', description: ARCHIVE_PROJECT_DESCRIPTION }] } })
    expect(await findOrCreateProject(client as never, ORG, USER, 'KURUMAN MALL')).toEqual({ id: 'p1', created: false })
    expect(calls.filter((c) => c.op === 'insert')).toEqual([])
  })
  it('refuses a real project that happens to share the site name (it might carry a Solar study)', async () => {
    const { client, calls } = fakeSupabase({ tables: { 'projects.projects': [{ id: 'p1', organisation_id: ORG, name: 'KURUMAN MALL', description: 'Solar study' }] } })
    await expect(findOrCreateProject(client as never, ORG, USER, 'KURUMAN MALL')).rejects.toThrow(/was not made by this import/)
    expect(calls.filter((c) => c.op === 'insert')).toEqual([])
  })
  it('creates a planning-status project named after the folder, stamped with the owner', async () => {
    const { client, calls } = fakeSupabase({ tables: { 'projects.projects': [] }, writes: { 'projects.projects:insert': { data: { id: 'new' } } } })
    expect(await findOrCreateProject(client as never, ORG, USER, 'KURUMAN MALL')).toEqual({ id: 'new', created: true })
    expect(calls.find((c) => c.op === 'insert')?.payload).toEqual({
      organisation_id: ORG, name: 'KURUMAN MALL', status: 'planning', project_type: 'retail', description: ARCHIVE_PROJECT_DESCRIPTION, created_by: USER,
    })
  })
  it('refuses to guess between two projects of the same name', async () => {
    const { client } = fakeSupabase({ tables: { 'projects.projects': [{ id: 'a', organisation_id: ORG, name: 'X' }, { id: 'b', organisation_id: ORG, name: 'X' }] } })
    await expect(findOrCreateProject(client as never, ORG, USER, 'X')).rejects.toThrow(/more than one/)
  })
})

describe('applyArchive disk guard', () => {
  it('stops before writing anything once the disk is over the limit', async () => {
    const { applyArchive } = await import('./apply')
    const { client, calls } = fakeSupabase({ tables: { 'projects.projects': [] } })
    const out = (await import('node:os')).tmpdir()
    const d = { action: 'load', site: 'X', fileName: 'x.csv', kind: 'tenant', label: 'x', shopNo: null, areaM2: null, channels: [] as Array<{ sourceColumn: string; isPrimary: boolean }>, readings: 1, bodySha256: 'h', pnpSerial: null } as LoadDecision
    await applyArchive({ decisions: [d], files: [], org: ORG, user: USER, out, client: client as never, maxDiskPct: 75, diskUsedPct: async () => 80 })
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
  })
})
