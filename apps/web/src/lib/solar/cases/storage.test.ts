// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { getGzipText, putGzipText, runCsvPath, weatherPath, RUNS_BUCKET } from './storage'
import { jhbTmyCsv } from './__fixtures__/weather'

function fakeStorage() {
  const objects = new Map<string, Buffer>()
  const bucket = (b: string) => ({
    upload: vi.fn(async (p: string, body: Buffer, opts: { contentType: string; upsert: boolean }) => {
      if (opts.contentType !== 'application/gzip') return { error: { message: 'bad type' } }
      objects.set(`${b}/${p}`, body); return { error: null }
    }),
    download: vi.fn(async (p: string) => {
      const o = objects.get(`${b}/${p}`)
      return o ? { data: new Blob([new Uint8Array(o)]), error: null } : { data: null, error: { message: 'not found' } }
    }),
    remove: vi.fn(async () => ({ error: null })),
  })
  return { client: { storage: { from: bucket } }, objects }
}

describe('solar storage', () => {
  it('gzip round-trips text', async () => {
    const { client, objects } = fakeStorage()
    await putGzipText(client as never, RUNS_BUCKET, 'o/p/c/r.csv.gz', 'hello,world\n')
    expect(objects.get('solar-runs/o/p/c/r.csv.gz')).toEqual(gzipSync(Buffer.from('hello,world\n')))
    await expect(getGzipText(client as never, RUNS_BUCKET, 'o/p/c/r.csv.gz')).resolves.toBe('hello,world\n')
  })
  it('a missing object is an error with a sentence', async () => {
    const { client } = fakeStorage()
    await expect(getGzipText(client as never, RUNS_BUCKET, 'nope')).rejects.toThrow('stored file not found')
  })
  it('an upload failure throws a fixed sentence; the backend text is logged, not surfaced', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = { storage: { from: () => ({ upload: async () => ({ error: { message: 'new row violates policy on bucket_id=solar-runs (pg 42501)' } }) }) } }
    await expect(putGzipText(client as never, RUNS_BUCKET, 'o/p/c/r.csv.gz', 'x')).rejects.toThrow('The file could not be stored — try again.')
    await expect(putGzipText(client as never, RUNS_BUCKET, 'o/p/c/r.csv.gz', 'x')).rejects.not.toThrow(/42501|bucket_id/)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('paths are org-first', () => {
    expect(runCsvPath('o', 'p', 'c', 'r')).toBe('o/p/c/r.csv.gz')
    expect(weatherPath('o', 'd')).toBe('o/d.csv.gz')
  })
  it('the weather fixture helper reads the verbatim PVGIS response (no network)', () => {
    expect(jhbTmyCsv()).toMatch(/Latitude/)
  })
})
