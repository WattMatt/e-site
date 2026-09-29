// apps/web/src/lib/solar/meter-import/register.ts
/**
 * Register raw bytes already in solar-meter-raw at <org>/<project>/<sha256>.<ext> as a
 * solar.meter_files row. Shared by POST …/meter-files (browser upload) and the Dropbox import.
 * The caller has already proved the path and recomputed the sha from the bytes.
 */
import type { FileMeter, MeterImportRepo } from './repo'

export type RegisterOutcome =
  | { status: 201; body: { fileId: string; duplicate: false } }
  | { status: 200; body: { fileId: string; duplicate: true; status: string } }
  | { status: 409; body: { error: 'duplicate_in_other_project'; fileId: string; meters: FileMeter[] } }

export async function registerStoredRawFile(repo: MeterImportRepo, a: {
  projectId: string; orgId: string; storagePath: string; originalName: string; bytes: Uint8Array; sha: string
}): Promise<RegisterOutcome> {
  const existing = await repo.fileBySha(a.orgId, a.sha)
  if (existing && existing.project_id !== a.projectId) {
    // meter_files is unique per (org, sha256): these bytes cannot get a row of their own here. Say where
    // the data already lives so the dialog can offer "Same data as <meter> at <site>" → Copy from library.
    return { status: 409, body: { error: 'duplicate_in_other_project', fileId: existing.id, meters: await repo.metersForFile(existing.id) } }
  }
  if (existing) return { status: 200, body: { fileId: existing.id, duplicate: true, status: existing.status } }
  const row = await repo.insertFile({
    project_id: a.projectId, organisation_id: a.orgId, sha256: a.sha, size_bytes: a.bytes.byteLength,
    storage_path: a.storagePath, original_name: a.originalName,
  })
  return { status: 201, body: { fileId: row.id, duplicate: false } }
}
