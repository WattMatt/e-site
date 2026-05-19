import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const WRITABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required']

export async function POST(req: NextRequest) {
  // 1. Authenticate via cookie client (RLS-protected).
  const userClient = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const inspectionId = fd.get('inspectionId') as string | null
  const sectionId = fd.get('sectionId') as string | null
  const fieldId = fd.get('fieldId') as string | null
  if (!file || !inspectionId || !sectionId || !fieldId) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  // 2. Read inspection via the USER's session — reaching this point proves the
  //    user has read access (SELECT RLS guards cross-org / cross-project).
  const { data: insp } = await userClient
    .schema('inspections')
    .from('inspections')
    .select('project_id, status')
    .eq('id', inspectionId)
    .single()
  if (!insp) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })

  // 3. Explicit writable-status guard (mirrors user_can_write_responses helper).
  if (!WRITABLE_STATUSES.includes(insp.status as string)) {
    return NextResponse.json(
      {
        error: `Cannot upload to inspection in status '${insp.status}'. Must be assigned, in_progress, or re-inspect_required.`,
      },
      { status: 403 },
    )
  }

  // 4. Storage upload (bucket RLS handles this; user's session is fine).
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${insp.project_id}/${inspectionId}/${sectionId}/${fieldId}/${Date.now()}-${safeName}`
  const { error: upErr } = await userClient.storage
    .from('inspection-photos')
    .upload(path, file, { contentType: file.type })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 5. INSERT via service client. Cross-schema PostgREST writes (.schema('inspections').from('photos').insert)
  //    don't propagate JWT claims to RLS helper functions reliably — the SELECT above
  //    already gated org/project access, so we trust that gate and bypass RLS for the INSERT.
  //    Same pattern as Session 14 mobile notifications dispatch.
  const service = createServiceClient() as AnyClient
  const { data: row, error: rowErr } = await service
    .schema('inspections')
    .from('photos')
    .insert({
      inspection_id: inspectionId,
      section_id: sectionId,
      field_id: fieldId,
      storage_path: path,
      uploaded_by: user.id,
    })
    .select('id')
    .single()
  if (rowErr) {
    await userClient.storage.from('inspection-photos').remove([path])
    return NextResponse.json({ error: rowErr.message }, { status: 500 })
  }

  return NextResponse.json({ id: row.id, storage_path: path })
}
