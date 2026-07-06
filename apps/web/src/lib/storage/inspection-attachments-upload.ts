/**
 * inspection-attachments-upload — direct-to-storage upload for inspection
 * file fields (spec sheets, certificates, …).
 *
 * File bytes go straight from the browser to the Supabase
 * `inspection-attachments` bucket. They must NOT transit a Next.js API route:
 * Vercel caps serverless request bodies at ~4.5 MB and rejects anything larger
 * with a plain-text 413 before the route runs — the old
 * /api/inspections/upload-file route silently capped attachments at 4.5 MB.
 * With the direct upload the effective cap is the Supabase project's global
 * upload limit (50 MiB default; storage returns a readable "exceeded the
 * maximum allowed size" error beyond it).
 *
 * Authorization is unchanged by the direct upload:
 *   - the bucket's INSERT/DELETE RLS policies (migration 00073) gate on
 *     inspections.user_can_write_responses — active, non-client_viewer org
 *     member + writable inspection status (is_active hardened in 00153).
 *     The policies read the inspection id from the path's SECOND segment
 *     (storage.foldername(name)[2]), so the path convention below is
 *     load-bearing;
 *   - the follow-up DB attach (attachInspectionFileAction) inserts through
 *     the cookie-authenticated client, gated by the photos_insert RLS policy.
 *
 * Path convention (must match the 00073 bucket policies):
 *   {projectId}/{inspectionId}/{sectionId}/{fieldId}/{timestamp}-{sanitised filename}
 */

import { createClient } from '@/lib/supabase/client'

const BUCKET = 'inspection-attachments'

// Same accept-list the old upload-file route enforced. An empty file.type and
// application/octet-stream stay allowed — some browsers/OSes report generic
// types for .docx/.xlsx; the file input's `accept` attribute is the practical
// filter there.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])

// Mirrors inspections.user_can_write_responses so a non-writable status gets
// a readable message instead of the bucket policy's opaque RLS violation.
const WRITABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required']

export interface UploadedInspectionAttachment {
  storagePath: string
  filename: string
}

/**
 * Upload an inspection file attachment directly to storage.
 * Throws an Error with a user-readable message on validation or upload failure.
 */
export async function uploadInspectionAttachmentFile(opts: {
  inspectionId: string
  sectionId: string
  fieldId: string
  file: File
}): Promise<UploadedInspectionAttachment> {
  const { inspectionId, sectionId, fieldId, file } = opts

  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw new Error('Only PDF, Word (.docx) and Excel (.xlsx) files are accepted.')
  }

  const supabase = createClient()

  // The storage path needs the project id, and pre-checking the status here
  // turns a doomed upload into a friendly error (the old route did the same).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: insp } = await (supabase as any)
    .schema('inspections')
    .from('inspections')
    .select('project_id, status')
    .eq('id', inspectionId)
    .single()
  if (!insp) throw new Error('Inspection not found.')
  const { project_id, status } = insp as { project_id: string; status: string }
  if (!WRITABLE_STATUSES.includes(status)) {
    throw new Error(`Cannot upload file to inspection in status '${status}'.`)
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${project_id}/${inspectionId}/${sectionId}/${fieldId}/${Date.now()}-${safeName}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  return { storagePath, filename: file.name }
}

/**
 * Best-effort removal of an uploaded object — used to clean up the orphan
 * when the DB attach step fails after a successful upload. Never throws.
 */
export async function removeInspectionAttachmentFile(storagePath: string): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.storage.from(BUCKET).remove([storagePath])
  } catch {
    // best-effort — the caller already surfaced the real error
  }
}
