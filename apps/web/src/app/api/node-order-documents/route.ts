/**
 * POST /api/node-order-documents — upload a document for a node order.
 * DELETE /api/node-order-documents — best-effort cleanup of an orphaned object.
 *
 * Form data: projectId, nodeOrderId, docType (quote | order_instruction |
 * shop_drawing), file.
 *
 * Path convention: {projectId}/{nodeOrderId}/{docType}/{timestamp}-{filename}
 * — first segment is the project id so the bucket RLS helper can resolve it.
 *
 * The storage write uses the authenticated user client; the bucket RLS from
 * migration 00086 gates it to owner/admin/project_manager via
 * public.user_can_manage_project. The companion DB write goes through the
 * service-role key in node-order-document.actions.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'node-order-documents'
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB
const DOC_TYPES = new Set(['quote', 'order_instruction', 'shop_drawing'])
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const projectId = formData.get('projectId')
  const nodeOrderId = formData.get('nodeOrderId')
  const docType = formData.get('docType')
  const file = formData.get('file')

  if (
    typeof projectId !== 'string' ||
    typeof nodeOrderId !== 'string' ||
    typeof docType !== 'string'
  ) {
    return NextResponse.json(
      { error: 'projectId, nodeOrderId and docType are required' },
      { status: 400 },
    )
  }
  if (!uuidRe.test(projectId) || !uuidRe.test(nodeOrderId)) {
    return NextResponse.json({ error: 'Invalid projectId or nodeOrderId' }, { status: 400 })
  }
  if (!DOC_TYPES.has(docType)) {
    return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.` },
      { status: 413 },
    )
  }

  // Verify project access (RLS-gated read — rejects if user not in org).
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Verify the node order belongs to this project. The cookie client is
  // RLS-gated; reads through .schema() are safe (the gotcha is writes-only).
  const { data: order } = await (supabase as never as {
    schema: (s: string) => { from: (t: string) => any }
  })
    .schema('structure')
    .from('node_orders')
    .select('id')
    .eq('id', nodeOrderId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!order) {
    return NextResponse.json({ error: 'Node order not found' }, { status: 404 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${projectId}/${nodeOrderId}/${docType}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type })

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ storagePath, fileName: file.name })
}

/**
 * Best-effort cleanup of an orphaned storage object when the DB attach step
 * fails after a successful upload. Accepts { storagePath } as JSON.
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

  await supabase.storage.from(BUCKET).remove([body.storagePath])
  return NextResponse.json({ ok: true })
}
