import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const ALLOWED_ROLES = new Set(['inspector', 'verifier', 'client', 'witness'])
const WRITABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required', 'awaiting_verification']

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
  const role = fd.get('role') as string | null
  const fieldId = (fd.get('fieldId') as string | null) || null
  const sectionId = (fd.get('sectionId') as string | null) || null
  const signatoryName = fd.get('signatoryName') as string | null
  const signatoryTitle = fd.get('signatoryTitle') as string | null
  const registrationNumber = fd.get('registrationNumber') as string | null

  if (!file || !inspectionId || !role || !signatoryName) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: `invalid role: ${role}` }, { status: 400 })
  }

  // 2. Read inspection via the user's session (SELECT RLS gates access).
  const { data: insp } = await userClient
    .schema('inspections')
    .from('inspections')
    .select('project_id, status')
    .eq('id', inspectionId)
    .single()
  if (!insp) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })

  // 3. Signatures can also be captured during awaiting_verification (verifier sign-off).
  if (!WRITABLE_STATUSES.includes(insp.status as string)) {
    return NextResponse.json(
      { error: `Cannot upload signature to inspection in status '${insp.status}'.` },
      { status: 403 },
    )
  }

  // 4. Storage upload via user session.
  const path = `${insp.project_id}/${inspectionId}/${role}-${Date.now()}.png`
  const { error: upErr } = await userClient.storage
    .from('inspection-signatures')
    .upload(path, file, { contentType: 'image/png' })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 5. INSERT via raw PostgREST (supabase-js .schema() strips service-role auth).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    await userClient.storage.from('inspection-signatures').remove([path])
    return NextResponse.json({ error: 'server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 })
  }

  const restHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'inspections',
    Prefer: 'return=minimal',
  }

  // Re-signing a field-keyed signature: clear the prior row first so the
  // (inspection_id, section_id, field_id) unique index doesn't reject the
  // replacement. Legacy role-keyed rows (no fieldId) keep append behaviour.
  if (fieldId) {
    const q = new URLSearchParams({
      inspection_id: `eq.${inspectionId}`,
      field_id: `eq.${fieldId}`,
    })
    if (sectionId) q.set('section_id', `eq.${sectionId}`)
    await fetch(`${supabaseUrl}/rest/v1/signatures?${q.toString()}`, {
      method: 'DELETE',
      headers: restHeaders,
    }).catch(() => {})
  }

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/signatures`, {
    method: 'POST',
    headers: restHeaders,
    body: JSON.stringify({
      inspection_id: inspectionId,
      section_id: sectionId,
      field_id: fieldId,
      role,
      signatory_name: signatoryName,
      signatory_title: signatoryTitle || null,
      registration_number: registrationNumber || null,
      storage_path: path,
      signed_by: user.id,
    }),
  })
  if (!insertRes.ok) {
    const errText = await insertRes.text()
    await userClient.storage.from('inspection-signatures').remove([path])
    return NextResponse.json({ error: `INSERT failed (HTTP ${insertRes.status}): ${errText.slice(0, 300)}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
