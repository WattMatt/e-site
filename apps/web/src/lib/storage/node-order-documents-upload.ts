/**
 * node-order-documents-upload — direct-to-storage upload for Equipment &
 * Materials procurement documents (quotes, order instructions, shop drawings).
 *
 * File bytes go straight from the browser to the Supabase
 * `node-order-documents` bucket. They must NOT transit a Next.js API route:
 * Vercel caps serverless request bodies at ~4.5 MB and rejects anything larger
 * with a plain-text 413 before the route runs, which made the 50 MB cap the
 * old /api/node-order-documents route advertised unreachable.
 *
 * Authorization is unchanged by the direct upload:
 *   - the bucket's INSERT/DELETE RLS policies (migration 00086) allow only
 *     owner/admin/project_manager org members of the project in the path's
 *     first segment, via user_can_manage_project (is_active-hardened in
 *     00152) — the same cookie-session gate the old route's storage write
 *     relied on;
 *   - the follow-up DB attach (node-order-document.actions.ts /
 *     node-order-shop-drawing.actions.ts) carries its own guardProjectAccess +
 *     order-belongs-to-project chain.
 *
 * Path convention (must match the bucket policies in migration 00086):
 *   {projectId}/{nodeOrderId}/{docType}/{timestamp}-{sanitised filename}
 */

import { createClient } from '@/lib/supabase/client'

const BUCKET = 'node-order-documents'

// Same 50 MB app cap the old route enforced. The bucket itself has no
// file_size_limit; the Supabase project's global upload limit (50 MiB
// default) is the hard backstop.
const MAX_BYTES = 50 * 1024 * 1024

export type NodeOrderDocType = 'quote' | 'order_instruction' | 'shop_drawing'

export interface UploadedNodeOrderDocument {
  storagePath: string
  fileName: string
}

/**
 * Upload a node-order document file directly to storage.
 * Throws an Error with a user-readable message on validation or upload failure.
 */
export async function uploadNodeOrderDocumentFile(opts: {
  projectId: string
  nodeOrderId: string
  docType: NodeOrderDocType
  file: File
}): Promise<UploadedNodeOrderDocument> {
  const { projectId, nodeOrderId, docType, file } = opts

  if (file.size > MAX_BYTES) {
    throw new Error(`File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.`)
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${projectId}/${nodeOrderId}/${docType}/${Date.now()}-${safeName}`

  const supabase = createClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  return { storagePath, fileName: file.name }
}

/**
 * Best-effort removal of an uploaded object — used to clean up the orphan
 * when the DB attach step fails after a successful upload. Never throws.
 */
export async function removeNodeOrderDocumentFile(storagePath: string): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.storage.from(BUCKET).remove([storagePath])
  } catch {
    // best-effort — the caller already surfaced the real error
  }
}
