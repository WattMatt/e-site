// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMeterFile } from '@esite/shared/meter-data'
import { fakeSupabase } from '@/test/fake-supabase'
import { tmpdir } from 'node:os'
import { ARCHIVE_PROJECT_DESCRIPTION, commitBody, retireArchiveProjects } from './apply'
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

describe('retireArchiveProjects', () => {
  const P = { id: 'p1', organisation_id: ORG, name: 'KOKSTAD', description: ARCHIVE_PROJECT_DESCRIPTION }
  const FILE = { id: 'f1', project_id: 'p1', sha256: 'a'.repeat(64), storage_path: `${ORG}/p1/${'a'.repeat(64)}.csv` }
  const withStorage = (client: Record<string, unknown>, moves: Array<[string, string]>) => Object.assign(client, {
    storage: { from: () => ({ move: async (from: string, to: string) => { moves.push([from, to]); return { error: null } } }) },
  })
  it('dry run: reports and writes nothing', async () => {
    const { client, calls } = fakeSupabase({ tables: { 'projects.projects': [P], 'solar.meter_files': [FILE], 'solar.audit_events': [] } })
    const moves: Array<[string, string]> = []
    await retireArchiveProjects({ org: ORG, out: tmpdir(), apply: false, client: withStorage(client as never, moves) as never })
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
    expect(moves).toEqual([])
  })
  it('apply: moves each raw file to <org>/archive, detaches the row, then deletes the project — only a project this import made', async () => {
    const { client, calls } = fakeSupabase({ tables: { 'projects.projects': [P], 'solar.meter_files': [FILE], 'solar.audit_events': [] } })
    const moves: Array<[string, string]> = []
    // After the detach the fake still holds the row; make the post-check count see none.
    const wrapped = withStorage(client as never, moves)
    const realSchema = (wrapped as unknown as { schema: (s: string) => unknown }).schema
    let detached = false
    ;(wrapped as unknown as { schema: (s: string) => unknown }).schema = (sch: string) => {
      const api = realSchema(sch) as { from: (t: string) => Record<string, unknown> }
      return { ...api, from: (t: string) => {
        const b = api.from(t) as Record<string, (...x: unknown[]) => unknown>
        if (sch === 'solar' && t === 'meter_files') {
          return { ...b, update: (...x: unknown[]) => { detached = true; return b.update(...x) },
            select: (cols: string, o?: { head?: boolean }) => (o?.head && detached ? { eq: async () => ({ count: 0, data: null, error: null }) } : b.select(cols, o)) }
        }
        return b
      } }
    }
    await retireArchiveProjects({ org: ORG, out: tmpdir(), apply: true, client: wrapped as never })
    expect(moves).toEqual([[FILE.storage_path, `${ORG}/archive/${FILE.sha256}.csv`]])
    expect(calls.find((c) => c.op === 'update')?.payload).toEqual({ project_id: null, storage_path: `${ORG}/archive/${FILE.sha256}.csv` })
    const del = calls.find((c) => c.op === 'delete')
    expect(del?.table).toBe('projects.projects')
    expect(del?.filters).toEqual(expect.arrayContaining([['eq', 'id', 'p1'], ['eq', 'description', ARCHIVE_PROJECT_DESCRIPTION]]))
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
