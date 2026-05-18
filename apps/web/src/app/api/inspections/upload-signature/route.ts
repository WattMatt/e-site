import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const ALLOWED_ROLES = new Set(['inspector', 'verifier', 'client', 'witness'])

export async function POST(req: NextRequest) {
  const supabase = (await createClient()) as AnyClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const fd = await req.formData()
  const file = fd.get('file') as File | null
  const inspectionId = fd.get('inspectionId') as string | null
  const role = fd.get('role') as string | null
  const signatoryName = fd.get('signatoryName') as string | null
  const signatoryTitle = fd.get('signatoryTitle') as string | null
  const registrationNumber = fd.get('registrationNumber') as string | null

  if (!file || !inspectionId || !role || !signatoryName) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: `invalid role: ${role}` }, { status: 400 })
  }

  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('project_id')
    .eq('id', inspectionId)
    .single()
  if (!insp) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })

  const path = `${insp.project_id}/${inspectionId}/${role}-${Date.now()}.png`
  const { error: upErr } = await supabase.storage
    .from('inspection-signatures')
    .upload(path, file, { contentType: 'image/png' })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { error: rowErr } = await supabase
    .schema('inspections')
    .from('signatures')
    .insert({
      inspection_id: inspectionId,
      role,
      signatory_name: signatoryName,
      signatory_title: signatoryTitle || null,
      registration_number: registrationNumber || null,
      storage_path: path,
      signed_by: user.id,
    })
  if (rowErr) {
    await supabase.storage.from('inspection-signatures').remove([path])
    return NextResponse.json({ error: rowErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
