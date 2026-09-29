'use client'
/** Browser half of the meter import: hash, raw path, and the 3a register / parse / commit routes. */
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { loadErrorMessage } from './messages'

export const METER_UPLOAD_RE = /\.(csv|txt|xlsx|xls)$/i
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export async function sha256OfBlob(b: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

export function rawPath(orgId: string, projectId: string, sha: string, fileName: string): string | null {
  const ext = fileName.match(METER_UPLOAD_RE)?.[1]?.toLowerCase()
  return ext ? `${orgId}/${projectId}/${sha}.${ext}` : null
}

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

export type RegisterResponse = { ok: true; fileId: string; duplicate: boolean } | { ok: false; error: string; message: string }

export async function registerRawFile(projectId: string, storagePath: string, originalName: string): Promise<RegisterResponse> {
  const { status, json } = await post(`/api/projects/${projectId}/solar/meter-files`, { storagePath, originalName })
  if (status === 200 || status === 201) return { ok: true, fileId: String(json.fileId), duplicate: Boolean(json.duplicate) }
  if (status === 409 && json.error === 'duplicate_in_other_project') {
    const m = (json.meters as Array<{ label: string; siteLabel: string | null }> | undefined)?.[0]
    return { ok: false, error: 'duplicate_in_other_project', message: m ? `Same data as ${m.label}${m.siteLabel ? ` at ${m.siteLabel}` : ''} — use Copy from org meter library.` : loadErrorMessage('duplicate_in_other_project') }
  }
  const code = typeof json.error === 'string' ? json.error : 'commit_failed'
  return { ok: false, error: code, message: status === 403 ? 'You need Solar edit access to import.' : loadErrorMessage(code) }
}

export interface ParseOptionsInput { dateOrder?: 'DMY' | 'MDY' | 'YMD'; tsConvention?: 'begin' | 'end'; units?: Record<string, string>; areaM2?: number | null }

export async function parseFiles(projectId: string, fileIds: string[], options?: Record<string, ParseOptionsInput>): Promise<{ reviews: ReviewModel[]; failed: Array<{ fileId: string; message: string }> }> {
  const reviews: ReviewModel[] = []
  const failed: Array<{ fileId: string; message: string }> = []
  for (let i = 0; i < fileIds.length; i += 20) {
    const ids = fileIds.slice(i, i + 20)
    const { status, json } = await post(`/api/projects/${projectId}/solar/meter-files/parse`, options ? { fileIds: ids, options } : { fileIds: ids })
    if (status !== 200) { for (const id of ids) failed.push({ fileId: id, message: loadErrorMessage(String(json.error ?? 'commit_failed')) }); continue }
    for (const r of (json.results as Array<{ fileId: string; reviews?: ReviewModel[]; error?: string }>)) {
      if (r.reviews) reviews.push(...r.reviews)
      else failed.push({ fileId: r.fileId, message: loadErrorMessage(r.error) })
    }
  }
  return { reviews, failed }
}

export type CommitResult = { ok: true; meterId?: string; meterLabel?: string; reusedMeter?: boolean; registerRows?: number; skipped?: boolean } | { ok: false; message: string }

export async function commitReview(projectId: string, body: Record<string, unknown>): Promise<CommitResult> {
  const { status, json } = await post(`/api/projects/${projectId}/solar/meter-files/commit`, body)
  if (status === 200) return { ok: true, ...(json as object) }
  return { ok: false, message: status === 403 ? 'You need Solar edit access to import.' : loadErrorMessage(String(json.error ?? 'commit_failed')) }
}
