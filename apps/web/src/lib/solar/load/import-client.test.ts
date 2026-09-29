import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commitReview, parseFiles, rawPath, registerRawFile } from './import-client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => { vi.restoreAllMocks() })

describe('import client', () => {
  it('builds the raw path from the sha and a lower-cased allowed extension', () => {
    expect(rawPath('o', 'p', 'a'.repeat(64), 'Shop 12.CSV')).toBe(`o/p/${'a'.repeat(64)}.csv`)
    expect(rawPath('o', 'p', 'a'.repeat(64), 'x.pdf')).toBeNull()
  })
  it('register: 201/200 ok, 409 names where the data lives', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(201, { fileId: 'f1', duplicate: false }))
    expect(await registerRawFile('p', 'o/p/x.csv', 'x.csv')).toEqual({ ok: true, fileId: 'f1', duplicate: false })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(409, { error: 'duplicate_in_other_project', fileId: 'f9', meters: [{ meterId: 'm', label: 'Shop 7', siteLabel: 'YA' }] }))
    expect(await registerRawFile('p', 'o/p/x.csv', 'x.csv')).toEqual({ ok: false, error: 'duplicate_in_other_project', message: 'Same data as Shop 7 at YA — use Copy from org meter library.' })
  })
  it('parse: flattens reviews and keeps per-file failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { results: [{ fileId: 'f1', reviews: [{ fileId: 'f1' }] }, { fileId: 'f2', error: 'sha256_mismatch' }] }))
    const r = await parseFiles('p', ['f1', 'f2'])
    expect(r.reviews).toEqual([{ fileId: 'f1' }])
    expect(r.failed).toEqual([{ fileId: 'f2', message: 'The stored file does not match its fingerprint — upload it again.' }])
  })
  it('commit: maps an error code to its sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(409, { error: 'identity_conflict' }))
    expect(await commitReview('p', { mode: 'skip', fileId: 'f', reason: 'bad' })).toEqual({ ok: false, message: 'Resolve the identity conflict first: link to the existing meter, skip, or override with a reason.' })
  })
  it('commit: a 409 identity conflict hands the server identity back to the dialog (LS-01)', async () => {
    const identity = { sourceSerials: [], filenameSerial: null, conflicts: [{ kind: 'same_body', meterId: 'm7', message: 'Same data as Shop 7.' }], blocking: true }
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(409, { error: 'identity_conflict', identity }))
    expect(await commitReview('p', { mode: 'series' })).toEqual({ ok: false, message: 'Resolve the identity conflict first: link to the existing meter, skip, or override with a reason.', identity })
  })
  it('parse: two files in one upload with the same data — the later one carries a blocking same_body conflict (LS-01)', async () => {
    const r = (fileId: string, bodySha256: string | null) => ({ fileId, fileName: `${fileId}.csv`, outcome: 'series', bodySha256, identity: { sourceSerials: [], filenameSerial: null, conflicts: [], blocking: false } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { results: [{ fileId: 'f1', reviews: [r('f1', 'H')] }, { fileId: 'f2', reviews: [r('f2', 'H')] }, { fileId: 'f3', reviews: [r('f3', 'K')] }] }))
    const { reviews } = await parseFiles('p', ['f1', 'f2', 'f3'])
    expect(reviews[0].identity?.blocking).toBe(false)
    expect(reviews[1].identity).toMatchObject({ blocking: true, conflicts: [{ kind: 'same_body', message: 'Same data as f1.csv in this upload.' }] })
    expect(reviews[2].identity?.blocking).toBe(false)
  })
})
