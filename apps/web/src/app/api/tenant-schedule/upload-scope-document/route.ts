/**
 * POST /api/tenant-schedule/upload-scope-document
 *
 * Uploads an .xlsx or .pdf scope document to the `tenant-documents` bucket.
 * Path convention: {projectId}/{nodeId}/{timestamp}-{sanitisedFilename}
 *
 * Returns { storagePath, filename } on success.
 * Callers should then invoke attachScopeDocumentAction with the returned path.
 *
 * Auth: cookie session — verified before any storage write.
 * Storage write uses the authenticated user client (bucket RLS allows
 * org members with write access — see migration 00080 bucket policies).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'tenant-documents'
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB (no imposed cap per spec T1/T2)

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

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

  // 4. MIME check
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: 'Only PDF and Excel (.xlsx/.xls) files are accepted.' },
      { status: 415 },
    )
  }

  // 5. Size check
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.` },
      { status: 413 },
    )
  }

  // 6. Verify project access (RLS will also enforce, but fail fast here)
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // 7. Build storage path and upload
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
