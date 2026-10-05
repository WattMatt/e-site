// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeRepo } from './fake-repo'
import { expectedRawPath, loadVerifiedRaw } from './raw-file'
import type { MeterFileRow } from './repo'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const OTHER = '11111111-1111-4111-8111-111111111111'
const bytes = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n')
const sha = createHash('sha256').update(bytes).digest('hex')
const good = `${ORG}/${P}/${sha}.csv`

function file(over: Partial<MeterFileRow> = {}): MeterFileRow {
  return { id: 'f1', organisation_id: ORG, project_id: P, sha256: sha, size_bytes: bytes.byteLength, storage_path: good, original_name: 'a.csv', status: 'uploaded', ...over }
}

describe('loadVerifiedRaw', () => {
  it('returns the bytes when the path is exactly <org>/<project>/<sha>.<ext> and the bytes hash to the recorded sha', async () => {
    const { repo } = createFakeRepo({ raw: { [good]: bytes } })
    const r = await loadVerifiedRaw(repo, file(), ORG)
    expect(r.ok).toBe(true)
    if (r.ok) expect([...r.bytes]).toEqual([...bytes])
  })

  it.each([
    ['another org segment', `${OTHER}/${P}/${sha}.csv`],
    ['another project segment', `${ORG}/${OTHER}/${sha}.csv`],
    ['a name that is not the recorded sha', `${ORG}/${P}/${'0'.repeat(64)}.csv`],
    ['a parent-directory segment', `${ORG}/${P}/../${P}/${sha}.csv`],
    ['an extra segment', `${ORG}/${P}/x/${sha}.csv`],
    ['a disallowed extension', `${ORG}/${P}/${sha}.exe`],
    ['no extension', `${ORG}/${P}/${sha}`],
  ])('refuses %s without downloading anything', async (_label, path) => {
    const { repo } = createFakeRepo({ raw: { [path]: bytes } })
    let downloads = 0
    const spy = { ...repo, downloadRaw: async (p: string) => { downloads++; return repo.downloadRaw(p) } }
    const r = await loadVerifiedRaw(spy, file({ storage_path: path }), ORG)
    expect(r).toEqual({ ok: false, status: 422, body: { error: 'raw_path_invalid' } })
    expect(downloads).toBe(0)
  })

  it('refuses a row whose organisation is not the project org', async () => {
    const { repo } = createFakeRepo({ raw: { [good]: bytes } })
    expect(await loadVerifiedRaw(repo, file({ organisation_id: OTHER }), ORG)).toMatchObject({ ok: false, status: 422 })
  })

  it('refuses a recorded sha that is not 64 lowercase hex', async () => {
    const { repo } = createFakeRepo({ raw: { [good]: bytes } })
    expect(await loadVerifiedRaw(repo, file({ sha256: sha.toUpperCase() }), ORG)).toMatchObject({ ok: false, status: 422 })
  })

  it('404 when the object is missing', async () => {
    const { repo } = createFakeRepo({})
    expect(await loadVerifiedRaw(repo, file(), ORG)).toEqual({ ok: false, status: 404, body: { error: 'raw_file_missing' } })
  })

  it('409 when the stored bytes no longer hash to the recorded sha (never parsed)', async () => {
    const tampered = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,999\r\n')
    const { repo } = createFakeRepo({ raw: { [good]: tampered } })
    const r = await loadVerifiedRaw(repo, file(), ORG)
    expect(r).toMatchObject({ ok: false, status: 409, body: { error: 'sha256_mismatch' } })
  })

  it('413 when the download refuses an oversized object', async () => {
    const { repo } = createFakeRepo({})
    const big = { ...repo, downloadRaw: async () => { throw new Error('meter file is larger than 50 MB') } }
    expect(await loadVerifiedRaw(big, file(), ORG)).toEqual({ ok: false, status: 413, body: { error: 'file_too_large' } })
  })
})

describe('archive files (no project)', () => {
  const ORG = '11111111-1111-1111-1111-111111111111'
  const SHA = 'a'.repeat(64)
  it('expect <org>/archive/<sha>.<ext> when the file has no project', () => {
    expect(expectedRawPath(ORG, { project_id: null, sha256: SHA, storage_path: `${ORG}/archive/${SHA}.csv` })).toBe(`${ORG}/archive/${SHA}.csv`)
  })
  it('a project file keeps <org>/<project>/<sha>.<ext>', () => {
    expect(expectedRawPath(ORG, { project_id: 'p1', sha256: SHA, storage_path: `${ORG}/p1/${SHA}.csv` })).toBe(`${ORG}/p1/${SHA}.csv`)
  })
})
