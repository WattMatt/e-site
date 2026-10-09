/**
 * Hand a large generated PDF to the browser through storage instead of the response body.
 *
 * Vercel refuses a function response over ~4.5 MB, and a status-plan sheet or a report with the
 * status-plan appendix can exceed that (an A0 drawing embedded as vector). So the route renders,
 * uploads to the service-only `reports` bucket (00207) at a deterministic path with overwrite, and
 * answers 303 to a signed URL valid 10 minutes. fetch() follows the redirect (Supabase storage sends
 * `Access-Control-Allow-Origin: *`, and connect-src allows *.supabase.co); a plain link opens it.
 *
 * The caller must have gated the project BEFORE creating the service client it passes in.
 * `download` makes the signed URL an attachment with that file name; a fetch() caller can read the
 * name back from `download=` on response.url (Content-Disposition is not CORS-exposed).
 */
import { NextResponse } from 'next/server'
import { MAX_HANDOFF_PDF_BYTES } from './pdf-limits'

export { MAX_HANDOFF_PDF_BYTES }

export const PDF_HANDOFF_BUCKET = 'reports'
export const PDF_HANDOFF_TTL_SECONDS = 600

export interface HandoffStorage {
  from: (bucket: string) => {
    upload: (path: string, body: ArrayBuffer, opts: { contentType: string; upsert: boolean; cacheControl?: string }) => Promise<{ error: { message: string } | null }>
    createSignedUrl: (path: string, expiresIn: number, opts?: { download?: string | boolean }) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
  }
}

export const statusPlanSheetPath = (orgId: string, projectId: string, planId: string) => `${orgId}/${projectId}/status-plans/${planId}/sheet.pdf`
export const statusPlanPortalPath = (orgId: string, projectId: string, planId: string) => `${orgId}/${projectId}/status-plans/${planId}/portal.pdf`
/** Per user, so two people previewing different appendix options at once never get each other's file. */
export const tenantSchedulePreviewFolder = (orgId: string, projectId: string, userId: string) => `${orgId}/${projectId}/previews/${userId}`
/** Plus a per-request nonce: a slower earlier preview can never overwrite the file a newer one is about to sign. */
export const tenantSchedulePreviewPath = (orgId: string, projectId: string, userId: string, nonce: string) =>
  `${tenantSchedulePreviewFolder(orgId, projectId, userId)}/tenant-schedule-${nonce}.pdf`

/** Best-effort: keep the newest `keep` previews in a user's folder (the nonce makes each request a new object). Never throws. */
export async function pruneOldPreviews(
  storage: { from: (bucket: string) => unknown }, folder: string, keep = 3,
): Promise<void> {
  try {
    const bucket = storage.from(PDF_HANDOFF_BUCKET) as {
      list: (path: string, opts: { limit: number; sortBy: { column: string; order: string } }) => Promise<{ data: Array<{ name: string }> | null; error: unknown }>
      remove: (paths: string[]) => Promise<{ error: unknown }>
    }
    const { data, error } = await bucket.list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
    if (error || !data) return
    const old = data.map((f) => f.name).filter((n) => /^tenant-schedule-.+\.pdf$/.test(n)).slice(keep)
    if (old.length === 0) return
    const { error: rmErr } = await bucket.remove(old.map((n) => `${folder}/${n}`))
    if (rmErr) console.error('[pdf-handoff] old previews could not be removed')
  } catch {
    console.error('[pdf-handoff] preview pruning failed')
  }
}

const FAILED = 'The PDF was drawn but could not be handed over — try again.'

export async function pdfHandoffResponse(
  storage: HandoffStorage, path: string, bytes: Uint8Array, opts: { download?: string; logTag: string; maxBytes?: number },
): Promise<Response> {
  if (bytes.byteLength > (opts.maxBytes ?? MAX_HANDOFF_PDF_BYTES)) {
    console.error(`[${opts.logTag}] PDF too large to hand over`, bytes.byteLength)
    return NextResponse.json({ error: 'This PDF is too large to hand over. Try again with fewer plans.' }, { status: 413 })
  }
  const bucket = storage.from(PDF_HANDOFF_BUCKET)
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const { error: upErr } = await bucket.upload(path, body, { contentType: 'application/pdf', upsert: true, cacheControl: '0' })
  if (upErr) {
    console.error(`[${opts.logTag}] PDF upload failed`, upErr.message)
    return NextResponse.json({ error: FAILED }, { status: 500 })
  }
  const { data, error } = await bucket.createSignedUrl(path, PDF_HANDOFF_TTL_SECONDS, opts.download ? { download: opts.download } : undefined)
  if (error || !data?.signedUrl) {
    console.error(`[${opts.logTag}] PDF signing failed`, error?.message)
    return NextResponse.json({ error: FAILED }, { status: 500 })
  }
  const res = NextResponse.redirect(data.signedUrl, 303)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
