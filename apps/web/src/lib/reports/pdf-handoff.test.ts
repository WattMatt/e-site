// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  PDF_HANDOFF_BUCKET, PDF_HANDOFF_TTL_SECONDS, pdfHandoffResponse,
  statusPlanSheetPath, statusPlanPortalPath, tenantSchedulePreviewPath,
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
    // Per user: two people previewing different options at once must not receive each other's file.
    expect(tenantSchedulePreviewPath('o', 'p', 'u')).toBe('o/p/previews/u/tenant-schedule.pdf')
  })
})
