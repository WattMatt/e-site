// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  PDF_HANDOFF_BUCKET, PDF_HANDOFF_TTL_SECONDS, pdfHandoffResponse,
  statusPlanSheetPath, statusPlanPortalPath, tenantSchedulePreviewPath, tenantSchedulePreviewFolder, pruneOldPreviews,
  MAX_HANDOFF_PDF_BYTES,
} from './pdf-handoff'

function storage(over: { upload?: unknown; sign?: unknown } = {}) {
  const upload = vi.fn().mockResolvedValue(over.upload ?? { error: null })
  const createSignedUrl = vi.fn().mockResolvedValue(over.sign ?? { data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/reports/p?token=t' }, error: null })
  const from = vi.fn(() => ({ upload, createSignedUrl }))
  return { from, upload, createSignedUrl }
}
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46])

describe('pdfHandoffResponse', () => {
  it('uploads with overwrite to the reports bucket and answers 303 to a 10-minute signed URL', async () => {
    const s = storage()
    const res = await pdfHandoffResponse(s, 'org/proj/status-plans/plan/sheet.pdf', PDF, { download: 'sheet.pdf', logTag: 't' })
    expect(s.from).toHaveBeenCalledWith(PDF_HANDOFF_BUCKET)
    expect(PDF_HANDOFF_BUCKET).toBe('reports')
    const [path, body, opts] = s.upload.mock.calls[0]!
    expect(path).toBe('org/proj/status-plans/plan/sheet.pdf')
    expect(new Uint8Array(body as ArrayBufferLike)).toEqual(PDF)
    expect(opts).toMatchObject({ contentType: 'application/pdf', upsert: true })
    expect(s.createSignedUrl).toHaveBeenCalledWith('org/proj/status-plans/plan/sheet.pdf', PDF_HANDOFF_TTL_SECONDS, { download: 'sheet.pdf' })
    expect(PDF_HANDOFF_TTL_SECONDS).toBe(600)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://x.supabase.co/storage/v1/object/sign/reports/p?token=t')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('inline (no download name) signs without the download option', async () => {
    const s = storage()
    await pdfHandoffResponse(s, 'a/b.pdf', PDF, { logTag: 't' })
    expect(s.createSignedUrl).toHaveBeenCalledWith('a/b.pdf', PDF_HANDOFF_TTL_SECONDS, undefined)
  })

  it('an upload or signing failure is a 500 with a sentence, never the storage message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const s of [storage({ upload: { error: { message: 'Payload too large' } } }), storage({ sign: { data: null, error: { message: 'boom' } } })]) {
      const res = await pdfHandoffResponse(s, 'a/b.pdf', PDF, { logTag: 't' })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'The PDF was drawn but could not be handed over — try again.' })
    }
    err.mockRestore()
  })
})

describe('handoff paths: org first (the bucket convention), deterministic, one per purpose', () => {
  it('names each file', () => {
    expect(statusPlanSheetPath('o', 'p', 'pl')).toBe('o/p/status-plans/pl/sheet.pdf')
    expect(statusPlanPortalPath('o', 'p', 'pl')).toBe('o/p/status-plans/pl/portal.pdf')
    // Per user + per request: overlapping previews never receive each other's file.
    expect(tenantSchedulePreviewPath('o', 'p', 'u', 'ab12')).toBe('o/p/previews/u/tenant-schedule-ab12.pdf')
    expect(tenantSchedulePreviewFolder('o', 'p', 'u')).toBe('o/p/previews/u')
  })
})

describe('the final-size guard', () => {
  it('is 48 MiB, under the reports bucket limit of 50 MiB', () => {
    expect(MAX_HANDOFF_PDF_BYTES).toBe(48 * 1024 * 1024)
  })
  it('a PDF over the limit is refused with a sentence and nothing is uploaded', async () => {
    const s = storage()
    const res = await pdfHandoffResponse(s, 'a/b.pdf', new Uint8Array(11), { logTag: 't', maxBytes: 10 })
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/too large/)
    expect(s.upload).not.toHaveBeenCalled()
  })
  it('exactly at the limit is handed over', async () => {
    const s = storage()
    const res = await pdfHandoffResponse(s, 'a/b.pdf', new Uint8Array(10), { logTag: 't', maxBytes: 10 })
    expect(res.status).toBe(303)
  })
})

describe('pruneOldPreviews', () => {
  function listing(names: string[], over: { listError?: boolean; removeError?: boolean } = {}) {
    const list = vi.fn().mockResolvedValue(over.listError ? { data: null, error: { message: 'x' } } : { data: names.map((name) => ({ name })), error: null })
    const remove = vi.fn().mockResolvedValue(over.removeError ? { data: null, error: { message: 'x' } } : { data: [], error: null })
    return { storage: { from: () => ({ list, remove }) }, list, remove }
  }
  it('keeps the newest 3 tenant-schedule previews and removes the rest', async () => {
    const l = listing(['tenant-schedule-e.pdf', 'tenant-schedule-d.pdf', 'tenant-schedule-c.pdf', 'tenant-schedule-b.pdf', 'tenant-schedule-a.pdf'])
    await pruneOldPreviews(l.storage, 'o/p/previews/u', 3)
    expect(l.list).toHaveBeenCalledWith('o/p/previews/u', expect.objectContaining({ sortBy: { column: 'created_at', order: 'desc' } }))
    expect(l.remove).toHaveBeenCalledWith(['o/p/previews/u/tenant-schedule-b.pdf', 'o/p/previews/u/tenant-schedule-a.pdf'])
  })
  it('leaves unrelated files alone and does nothing when within the keep count', async () => {
    const l = listing(['tenant-schedule-a.pdf', 'notes.txt'])
    await pruneOldPreviews(l.storage, 'o/p/previews/u', 3)
    expect(l.remove).not.toHaveBeenCalled()
  })
  it('never throws, whatever storage does', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(pruneOldPreviews(listing([], { listError: true }).storage, 'f', 3)).resolves.toBeUndefined()
    await expect(pruneOldPreviews(listing(['tenant-schedule-1.pdf', 'tenant-schedule-2.pdf'], { removeError: true }).storage, 'f', 1)).resolves.toBeUndefined()
    await expect(pruneOldPreviews({ from: () => { throw new Error('boom') } } as never, 'f', 3)).resolves.toBeUndefined()
    err.mockRestore()
  })
})
