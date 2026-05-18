// apps/mobile/src/inspections/attachment-queue.ts
//
// Background queue for inspection photo / signature uploads.
//
// Photos + signatures are captured offline and stored under the app's
// documentDirectory. Each capture enqueues a row here; a worker
// (upload-worker.ts) drains the queue when connectivity returns,
// uploading the binary to Supabase Storage and inserting a row in
// inspections.photos or inspections.signatures.
//
// The local SQLite database is borrowed from PowerSync — we create
// our own non-synced table `attachment_uploads` via raw SQL. PowerSync
// itself doesn't manage this table (it lives outside the sync
// boundary), but executing SQL against the same DB connection gives us
// transactional consistency with the synced inspection rows.

import { powerSyncDb } from '../lib/powersync/database'

export type AttachmentBucket =
  | 'inspection-photos'
  | 'inspection-signatures'
  | 'inspection-attachments'

export type AttachmentStatus = 'pending' | 'uploading' | 'done' | 'failed'

export interface PendingAttachment {
  id: string
  inspection_id: string
  bucket: AttachmentBucket
  local_path: string // file:// URI on device
  remote_path: string // intended storage_path (may contain __placeholder__ for project_id)
  section_id: string | null
  field_id: string | null
  signature_role: string | null
  signatory_name: string | null
  signatory_title: string | null
  registration_number: string | null
  caption: string | null
  status: AttachmentStatus
  retry_count: number
  last_error: string | null
  created_at: string
}

export type EnqueueInput = Omit<
  PendingAttachment,
  'status' | 'retry_count' | 'last_error' | 'created_at'
>

/**
 * Create the local attachment_uploads table if it doesn't exist.
 * Idempotent — safe to call on every app boot.
 */
export async function ensureSchema(): Promise<void> {
  await powerSyncDb.execute(`
    CREATE TABLE IF NOT EXISTS attachment_uploads (
      id TEXT PRIMARY KEY,
      inspection_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      local_path TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      section_id TEXT,
      field_id TEXT,
      signature_role TEXT,
      signatory_name TEXT,
      signatory_title TEXT,
      registration_number TEXT,
      caption TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

export async function enqueueAttachment(a: EnqueueInput): Promise<void> {
  await powerSyncDb.execute(
    `INSERT INTO attachment_uploads (
      id, inspection_id, bucket, local_path, remote_path,
      section_id, field_id, signature_role, signatory_name, signatory_title,
      registration_number, caption
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      a.id,
      a.inspection_id,
      a.bucket,
      a.local_path,
      a.remote_path,
      a.section_id,
      a.field_id,
      a.signature_role,
      a.signatory_name,
      a.signatory_title,
      a.registration_number,
      a.caption,
    ],
  )
}

export async function pendingCount(): Promise<number> {
  const rs = await powerSyncDb.execute(
    `SELECT COUNT(*) AS c FROM attachment_uploads WHERE status IN ('pending','failed')`,
  )
  const row = firstRow<{ c: number }>(rs)
  return row?.c ?? 0
}

export async function nextPending(): Promise<PendingAttachment | null> {
  const rs = await powerSyncDb.execute(
    `SELECT * FROM attachment_uploads
     WHERE status='pending' OR (status='failed' AND retry_count < 5)
     ORDER BY created_at ASC LIMIT 1`,
  )
  return firstRow<PendingAttachment>(rs) ?? null
}

export async function markDone(id: string): Promise<void> {
  await powerSyncDb.execute(
    `UPDATE attachment_uploads SET status='done' WHERE id=?`,
    [id],
  )
}

export async function markFailed(id: string, err: string): Promise<void> {
  await powerSyncDb.execute(
    `UPDATE attachment_uploads
     SET status='failed', retry_count=retry_count+1, last_error=?
     WHERE id=?`,
    [err, id],
  )
}

/**
 * Look up the project_id for an inspection from the locally synced
 * inspections table. The worker uses this to replace the
 * `__placeholder__` segment of remote_path when uploading photos.
 */
export async function lookupProjectId(inspectionId: string): Promise<string | null> {
  const rs = await powerSyncDb.execute(
    `SELECT project_id FROM inspections WHERE id = ? LIMIT 1`,
    [inspectionId],
  )
  return firstRow<{ project_id: string | null }>(rs)?.project_id ?? null
}

// PowerSync's QueryResult exposes `rows._array` at runtime but isn't typed
// that way; tolerate the unknown index shape via a tiny helper.
function firstRow<T>(rs: { rows?: unknown }): T | undefined {
  const r = rs.rows as { _array?: unknown[] } | unknown[] | undefined
  if (!r) return undefined
  if (Array.isArray((r as { _array?: unknown[] })._array)) {
    return ((r as { _array: unknown[] })._array[0] as T) ?? undefined
  }
  if (Array.isArray(r)) {
    return (r[0] as T) ?? undefined
  }
  return undefined
}
