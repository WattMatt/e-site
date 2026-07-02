/**
 * tenant-documents-upload — direct-to-storage upload for tenant drawings and
 * scope documents.
 *
 * File bytes go straight from the browser to the Supabase `tenant-documents`
 * bucket. They must NOT transit a Next.js API route: Vercel caps serverless
 * request bodies at ~4.5 MB and rejects anything larger with a plain-text 413
 * before the route runs, which silently capped "no size limit" layout
 * drawings (T1) at 4.5 MB.
 *
 * Authorization is unchanged by the direct upload:
 *   - the bucket's INSERT RLS policy (migration 00080) allows only
 *     owner/admin/project_manager org members with access to the project in
 *     the path's first segment — the same cookie-session gate the old route's
 *     storage write relied on;
 *   - the follow-up DB attach (tenant-documents.actions.ts) carries its own
 *     guardProjectAccess + guardNodeBelongsToProject chain.
 *
 * Path convention (must match the bucket policies + migration 00080):
 *   {projectId}/{nodeId}/{timestamp}-{sanitised filename}
 */

import { createClient } from '@/lib/supabase/client'

const BUCKET = 'tenant-documents'

// Scope documents: PDF or Excel only, 50 MB cap. Layout drawings: any MIME
// type, no imposed size cap (T1) — bounded only by the Supabase project's
// global upload limit.
const SCOPE_MAX_BYTES = 50 * 1024 * 1024
const SCOPE_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

export interface UploadedTenantDocument {
  storagePath: string
  filename: string
}

/**
 * Upload a tenant-document file directly to storage.
 * Throws an Error with a user-readable message on validation or upload failure.
 */
export async function uploadTenantDocumentFile(opts: {
  projectId: string
  nodeId: string
  file: File
  kind: 'layout' | 'scope'
}): Promise<UploadedTenantDocument> {
  const { projectId, nodeId, file, kind } = opts

  if (kind === 'scope') {
    if (!SCOPE_ALLOWED_MIME.has(file.type)) {
      throw new Error('Only PDF and Excel (.xlsx/.xls) files are accepted.')
    }
    if (file.size > SCOPE_MAX_BYTES) {
      throw new Error(`File exceeds the ${SCOPE_MAX_BYTES / 1024 / 1024} MB limit.`)
    }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${projectId}/${nodeId}/${Date.now()}-${safeName}`

  const supabase = createClient()
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
export async function removeTenantDocumentFile(storagePath: string): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.storage.from(BUCKET).remove([storagePath])
  } catch {
    // best-effort — the caller already surfaced the real error
  }
}
