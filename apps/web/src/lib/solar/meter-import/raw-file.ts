/**
 * Load a stored raw meter file ONLY if it is exactly what the file row says it is.
 *
 * The register route accepts a path only when it is `<org>/<project>/<sha256>.<ext>` of the caller's
 * project (an org meter-archive file, which has no project, lives at `<org>/archive/<sha256>.<ext>`)
 * project and the bytes hash to that name. The row is the record of that check, but parse and commit
 * read the object again later, so they re-prove both before parsing:
 *   1. the recorded path must be byte-for-byte `<project org>/<row project>/<row sha256>.<ext>`
 *      (no `..`, no extra segment, allowed extension, lowercase 64-hex sha) and the row's org must
 *      be the project's org; otherwise nothing is downloaded;
 *   2. the downloaded bytes must hash to the recorded sha256; otherwise nothing is parsed.
 * Storage is read with the caller's client (repo), so the bucket policy applies as well.
 */
import { sha256Hex } from '@esite/shared/meter-data'
import type { MeterFileRow, MeterImportRepo } from './repo'

const SHA_RE = /^[0-9a-f]{64}$/
const EXT_RE = /\.(csv|txt|xlsx|xls)$/

export type RawLoad =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; status: 404 | 409 | 413 | 422; body: { error: string } }

export function expectedRawPath(orgId: string, file: Pick<MeterFileRow, 'project_id' | 'sha256' | 'storage_path'>): string | null {
  if (!SHA_RE.test(file.sha256)) return null
  const ext = file.storage_path.match(EXT_RE)?.[1]
  if (!ext) return null
  // An org meter-archive file belongs to no project: it lives under <org>/archive/.
  return `${orgId}/${file.project_id ?? 'archive'}/${file.sha256}.${ext}`
}

export async function loadVerifiedRaw(repo: MeterImportRepo, file: MeterFileRow, orgId: string): Promise<RawLoad> {
  const expected = expectedRawPath(orgId, file)
  if (file.organisation_id !== orgId || !expected || file.storage_path !== expected) {
    return { ok: false, status: 422, body: { error: 'raw_path_invalid' } }
  }
  let bytes: Uint8Array | null
  try {
    bytes = await repo.downloadRaw(file.storage_path)
  } catch {
    return { ok: false, status: 413, body: { error: 'file_too_large' } }
  }
  if (!bytes) return { ok: false, status: 404, body: { error: 'raw_file_missing' } }
  if ((await sha256Hex(bytes)) !== file.sha256) return { ok: false, status: 409, body: { error: 'sha256_mismatch' } }
  return { ok: true, bytes }
}
