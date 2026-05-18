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

export async function POST(req: NextRequest) {
  const supabase = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
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

  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('project_id')
    .eq('id', inspectionId)
    .single()
  if (!insp) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${insp.project_id}/${inspectionId}/${sectionId}/${fieldId}/${Date.now()}-${safeName}`
  const { error: upErr } = await supabase.storage
    .from('inspection-attachments')
    .upload(path, file, { contentType: file.type })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: row, error: rowErr } = await supabase
    .schema('inspections')
    .from('attachments')
    .insert({
      inspection_id: inspectionId,
      section_id: sectionId,
      field_id: fieldId,
      storage_path: path,
      filename: file.name,
      mime_type: file.type || null,
      uploaded_by: user.id,
    })
    .select('id')
    .single()
  if (rowErr) {
    await supabase.storage.from('inspection-attachments').remove([path])
    return NextResponse.json({ error: rowErr.message }, { status: 500 })
  }

  return NextResponse.json({ id: row.id, storage_path: path, filename: file.name })
}
