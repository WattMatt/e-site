import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { runIngestJob, summariseIngestReport, type IngestJob } from './job-runner'
import { createMemoryTariffStore } from './memory-store'

const FIX = join(__dirname, '../__fixtures__/city-power-rfd-2026-27.excerpt.txt')
const PDF_BYTES = new Uint8Array([37, 80, 68, 70])
const SHA = createHash('sha256').update(PDF_BYTES).digest('hex')
const job = (over: Partial<IngestJob> = {}): IngestJob => ({
  id: 'job-1', sourceDocumentId: 'doc-1', parser: 'rfd_pdf', financialYear: '2026/27',
  licenseeName: 'City Power', createLicensees: false, requestedBy: 'u-1', ...over,
})

describe('runIngestJob', () => {
  it('downloads, extracts PDF text, ingests and lands the year in review', async () => {
    const store = createMemoryTariffStore({ licensees: [{ name: 'City Power', kind: 'metro', aliases: ['CITY POWER'] }] })
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: `2026-27/${SHA}.pdf`, fileName: 'city-power.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => PDF_BYTES,
      pdfToText: async () => readFileSync(FIX, 'utf8'),
      store,
    })
    expect(out.status).toBe('succeeded')
    expect(out.error).toBeNull()
    expect(out.detail).toBeNull()
    expect(out.report?.status).toBe('applied')
    expect(out.report?.years[0].action).toBe('create')
    expect(out.report?.years[0].tariffs).toBeGreaterThan(0)
    expect([...store.state.years.values()][0]).toMatchObject({ financialYear: '2026/27', state: 'in_review' })
  })
  it('stored bytes that no longer hash to the registered sha256 fail the job before anything is parsed or written', async () => {
    const store = createMemoryTariffStore({ licensees: [{ name: 'City Power', kind: 'metro', aliases: ['CITY POWER'] }] })
    let parsed = false
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: `2026-27/${SHA}.pdf`, fileName: 'city-power.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => new Uint8Array([37, 80, 68, 70, 0]),
      pdfToText: async () => { parsed = true; return readFileSync(FIX, 'utf8') },
      store,
    })
    expect(out).toEqual({ status: 'failed', report: null, runId: null, detail: null,
      error: "The file's checksum no longer matches the registered document. Upload it again as a new document." })
    expect(parsed).toBe(false)
    expect(store.state.writes).toEqual([])
  })
  it('a missing source document fails the job with a sentence', async () => {
    const out = await runIngestJob(job(), {
      loadSource: async () => null, download: async () => new Uint8Array(), pdfToText: async () => '', store: createMemoryTariffStore(),
    })
    expect(out).toEqual({ status: 'failed', report: null, runId: null, detail: null, error: 'The source document no longer exists.' })
  })
  it('a text-extraction failure fails the job and writes nothing', async () => {
    const store = createMemoryTariffStore({ licensees: [{ name: 'City Power', kind: 'metro', aliases: ['CITY POWER'] }] })
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: 'p', fileName: 'f.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => PDF_BYTES,
      pdfToText: async () => { throw new Error('pdftotext: not found') },
      store,
    })
    expect(out.status).toBe('failed')
    expect(out.error).toBe('The PDF could not be read.')
    expect(out.detail).toBe('pdftotext: not found')
    expect(store.state.writes).toEqual([])
  })
  it('a download failure stores a fixed sentence; the raw text goes to detail only', async () => {
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: 'p', fileName: 'f.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => { throw new Error('Object not found: tariff-sources/p (bucket policy 42501)') },
      pdfToText: async () => '', store: createMemoryTariffStore(),
    })
    expect(out).toEqual({ status: 'failed', report: null, runId: null,
      error: 'The stored file could not be downloaded.', detail: 'Object not found: tariff-sources/p (bucket policy 42501)' })
  })
  it('an ingest failure stores a fixed sentence, not the exception text', async () => {
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: 'p', fileName: 'f.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => PDF_BYTES,
      pdfToText: async () => readFileSync(FIX, 'utf8'),
      store: new Proxy({}, { get: () => async () => { throw new Error('relation "tariffs.licensee" does not exist') } }) as never,
    })
    expect(out.status).toBe('failed')
    expect(out.error).toBe('The ingest failed — run it again or check the worker log.')
    expect(out.detail).toContain('relation "tariffs.licensee" does not exist')
  })
  it('summarises a report for storage and display (issues capped at 25)', () => {
    const issues = Array.from({ length: 30 }, (_, k) => ({ code: 'inferred_unit' as const, severity: 'review' as const, message: `m${k}`, tariff: 'T' }))
    const s = summariseIngestReport({
      status: 'applied', sha256: SHA, sourceDocumentId: 'd', runId: 'r', storagePath: 'p',
      years: [{ licensee: 'City Power', financialYear: '2026/27', action: 'create', licenseeId: 'l', yearId: 'y',
        tariffs: 3, charges: 9, blocking: 0, review: 30, unresolved: 1, yoy: null, issues }],
    })
    expect(s.runId).toBe('r')
    expect(s.years[0]).toMatchObject({ licensee: 'City Power', action: 'create', tariffs: 3, review: 30 })
    expect(s.years[0].issues).toHaveLength(25)
    expect(s.years[0].issues[0]).toEqual({ code: 'inferred_unit', severity: 'review', message: 'm0', tariff: 'T' })
  })
})
