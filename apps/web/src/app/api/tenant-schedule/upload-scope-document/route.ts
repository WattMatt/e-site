/**
 * POST /api/tenant-schedule/upload-scope-document
 *
 * Unified upload route for both scope documents and layout drawings.
 * Accepts an optional `kind` field in the form data:
 *   - kind = 'scope'  (default) — PDF / Excel only; 50 MB cap
 *   - kind = 'layout'           — any MIME type; no size cap (T1 spec requirement)
 *
 * Path convention: {projectId}/{nodeId}/{timestamp}-{sanitisedFilename}
 *
 * Returns { storagePath, filename } on success.
 * Callers should then invoke attachScopeDocumentAction or attachLayoutDrawingAction.
 *
 * Auth: cookie session — verified before any storage write.
 * Storage write uses the authenticated user client (bucket RLS allows
 * org members with write access — see migration 00080 bucket policies).
 *
 * Note: the companion DB write goes through the service-role key via raw
 * PostgREST fetch, bypassing RLS. The authorization gate for that write is
 * the explicit node-ownership check performed here — NOT RLS on the DB write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'tenant-documents'
// Scope documents: PDF or Excel only
const SCOPE_MAX_BYTES = 50 * 1024 * 1024 // 50 MB
const SCOPE_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])
// Layout drawings: any MIME type, no imposed size cap (T1)

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  // 2. Parse form data
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const projectId = formData.get('projectId')
  const nodeId = formData.get('nodeId')
  const file = formData.get('file')
  const kindRaw = formData.get('kind')
  const kind: 'scope' | 'layout' =
    kindRaw === 'layout' ? 'layout' : 'scope'

  if (typeof projectId !== 'string' || typeof nodeId !== 'string') {
    return NextResponse.json({ error: 'projectId and nodeId are required' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }

  // 3. Validate UUID shape
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(projectId) || !uuidRe.test(nodeId)) {
    return NextResponse.json({ error: 'Invalid projectId or nodeId' }, { status: 400 })
  }

  // 4. Kind-specific validation
  if (kind === 'scope') {
    if (!SCOPE_ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF and Excel (.xlsx/.xls) files are accepted.' },
        { status: 415 },
      )
    }
    if (file.size > SCOPE_MAX_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${SCOPE_MAX_BYTES / 1024 / 1024} MB limit.` },
        { status: 413 },
      )
    }
  }
  // layout: accept any MIME, no size cap (T1)

  // 5. Verify project access (RLS will also enforce, but fail fast here)
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // 5b. Validate the nodeId belongs to this project.
  // The cookie client is RLS-gated so a node from another org returns null.
  // Reads through .schema() are safe — the cross-schema service-role gotcha
  // applies to writes only.
  const { data: node } = await supabase
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 })
  }

  // 6. Build storage path and upload
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${projectId}/${nodeId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type })

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ storagePath, filename: file.name })
}

/**
 * DELETE /api/tenant-schedule/upload-scope-document
 *
 * Best-effort cleanup of an orphaned storage object when the DB attach step
 * fails after a successful upload. Accepts { storagePath: string } as JSON.
 * Uses the cookie client so RLS on the bucket prevents cross-org deletes.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  let body: { storagePath?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.storagePath !== 'string' || !body.storagePath) {
    return NextResponse.json({ error: 'storagePath required' }, { status: 400 })
  }

  // Best-effort — ignore storage errors (caller already surfaced the real error)
  await supabase.storage.from(BUCKET).remove([body.storagePath])

  return NextResponse.json({ ok: true })
}
