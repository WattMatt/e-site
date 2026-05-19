import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])
const WRITABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required']

export async function POST(req: NextRequest) {
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
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `unsupported MIME type: ${file.type}` }, { status: 400 })
  }

  const { data: insp } = await userClient
    .schema('inspections')
    .from('inspections')
    .select('project_id, status')
    .eq('id', inspectionId)
    .single()
  if (!insp) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })

  if (!WRITABLE_STATUSES.includes(insp.status as string)) {
    return NextResponse.json(
      { error: `Cannot upload file to inspection in status '${insp.status}'.` },
      { status: 403 },
    )
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${insp.project_id}/${inspectionId}/${sectionId}/${fieldId}/${Date.now()}-${safeName}`
  const { error: upErr } = await userClient.storage
    .from('inspection-attachments')
    .upload(path, file, { contentType: file.type })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Per spec §4.4: file attachments re-use inspections.photos with a different bucket.
  // INSERT via raw PostgREST (supabase-js .schema() strips service-role auth).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    await userClient.storage.from('inspection-attachments').remove([path])
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
      caption: file.name,
      uploaded_by: user.id,
    }),
  })
  if (!insertRes.ok) {
    const errText = await insertRes.text()
    await userClient.storage.from('inspection-attachments').remove([path])
    return NextResponse.json({ error: `INSERT failed (HTTP ${insertRes.status}): ${errText.slice(0, 300)}` }, { status: 500 })
  }
  const rows = (await insertRes.json()) as Array<{ id: string }>
  const row = rows[0]
  if (!row) {
    await userClient.storage.from('inspection-attachments').remove([path])
    return NextResponse.json({ error: 'INSERT returned no row' }, { status: 500 })
  }

  return NextResponse.json({ id: row.id, storage_path: path, filename: file.name })
}
