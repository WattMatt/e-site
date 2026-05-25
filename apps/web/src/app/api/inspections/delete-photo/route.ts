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

  let body: { photoId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const photoId = body.photoId
  if (!photoId) return NextResponse.json({ error: 'missing photoId' }, { status: 400 })

  // 2. Load the photo row via the user's session — RLS gates visibility, so
  //    reaching this point means the caller is allowed to read it. We also
  //    need its storage_path + inspection_id for the status check + file delete.
  const { data: photo } = await userClient
    .schema('inspections')
    .from('photos')
    .select('id, inspection_id, storage_path')
    .eq('id', photoId)
    .single()
  if (!photo) return NextResponse.json({ error: 'photo not found' }, { status: 404 })

  // 3. Inspection-status guard — only writable statuses may mutate photos.
  //    Mirrors upload-photo's check; matches the user_can_write_responses
  //    helper that gates the underlying RLS policies.
  const { data: insp } = await userClient
    .schema('inspections')
    .from('inspections')
    .select('status')
    .eq('id', photo.inspection_id)
    .single()
  if (!insp) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })
  if (!WRITABLE_STATUSES.includes(insp.status as string)) {
    return NextResponse.json(
      {
        error: `Cannot delete photo on inspection in status '${insp.status}'. Must be assigned, in_progress, or re-inspect_required.`,
      },
      { status: 403 },
    )
  }

  // 4. DELETE the DB row via raw PostgREST + service-role. Same reasoning as
  //    upload-photo's INSERT: supabase-js's .schema('inspections')... writes
  //    fall back to anon and hit RLS; a raw HTTP call with the service key
  //    bypasses RLS reliably.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      { error: 'server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' },
      { status: 500 },
    )
  }

  const deleteRes = await fetch(
    `${supabaseUrl}/rest/v1/photos?id=eq.${encodeURIComponent(photoId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Profile': 'inspections',
        Prefer: 'return=minimal',
      },
    },
  )
  if (!deleteRes.ok) {
    const errText = await deleteRes.text()
    return NextResponse.json(
      { error: `DELETE failed (HTTP ${deleteRes.status}): ${errText.slice(0, 300)}` },
      { status: 500 },
    )
  }

  // 5. Delete the storage file. Storage RLS (migration 00073) gates this on
  //    user_can_write_responses, so the user's session works. If the file
  //    delete fails, the DB row is already gone — the user's view is
  //    consistent (no broken thumbnails). The orphaned file is invisible and
  //    can be swept by a periodic GC if it becomes a concern.
  const { error: storageErr } = await userClient.storage
    .from('inspection-photos')
    .remove([photo.storage_path])
  if (storageErr) {
    console.error('inspection-photos storage delete failed (row already gone):', {
      photoId,
      path: photo.storage_path,
      message: storageErr.message,
    })
  }

  return NextResponse.json({ ok: true })
}
