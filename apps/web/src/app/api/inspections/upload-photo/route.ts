import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  // 5. INSERT via raw PostgREST POST with service-role key. supabase-js's
  //    .schema('inspections').from('photos').insert() does NOT propagate the
  //    service-role Authorization header — it falls back to anon, which then
  //    hits RLS. Verified via direct curl: raw POST with the service key DOES
  //    bypass RLS (got FK violation instead of RLS rejection on a fake UUID).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    await userClient.storage.from('inspection-photos').remove([path])
    return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 })
  }

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/photos`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'inspections',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      inspection_id: inspectionId,
      section_id: sectionId,
      field_id: fieldId,
      storage_path: path,
      uploaded_by: user.id,
    }),
  })
  if (!insertRes.ok) {
    const errText = await insertRes.text()
    await userClient.storage.from('inspection-photos').remove([path])
    return NextResponse.json({ error: `INSERT failed (HTTP ${insertRes.status}): ${errText.slice(0, 300)}` }, { status: 500 })
  }
  const rows = (await insertRes.json()) as Array<{ id: string }>
  const row = rows[0]
  if (!row) {
    await userClient.storage.from('inspection-photos').remove([path])
    return NextResponse.json({ error: 'INSERT returned no row' }, { status: 500 })
  }

  return NextResponse.json({ id: row.id, storage_path: path })
}
