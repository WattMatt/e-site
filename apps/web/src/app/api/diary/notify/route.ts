/**
 * POST /api/diary/notify
 *
 * Server-side notify proxy for diary entries. Mobile clients hold an
 * `authenticated` JWT and cannot run the service-role notification fan-out
 * themselves, so they call this route after creating an entry (and uploading its
 * attachments). It authenticates the caller, verifies they belong to the entry's
 * organisation, then runs the SAME notifyDiaryEntryCreated path the web app uses
 * — bell + full-entry email with inline photo thumbnails — so web and mobile
 * converge on one notification implementation.
 *
 * Auth: Authorization: Bearer <supabase access_token>
 * Body: { entryId: string (uuid) }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@esite/db'
import { rateLimit } from '@/lib/rate-limit'
import { notifyDiaryEntryCreated } from '@/lib/diary-email'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const bodySchema = z.object({ entryId: z.string().uuid() })

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  const accessToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Validate the JWT signature + expiry against Supabase Auth.
  const anon = createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: userErr } = await anon.auth.getUser(accessToken)
  if (userErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`diary-notify:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let parsed
  try {
    parsed = bodySchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const { entryId } = parsed.data

  // Load the entry + confirm the caller belongs to its org. Service-role read;
  // the trust boundary is the JWT verified above.
  const service = createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: entry, error: entryErr } = await (service as any)
    .schema('projects').from('site_diary_entries')
    .select('id, project_id, organisation_id, created_by')
    .eq('id', entryId)
    .maybeSingle()
  if (entryErr) return NextResponse.json({ error: 'Failed to load entry' }, { status: 500 })
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  const { data: membership, error: memErr } = await service
    .from('user_organisations')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('organisation_id', entry.organisation_id)
    .eq('is_active', true)
    .maybeSingle()
  if (memErr) return NextResponse.json({ error: 'Failed to verify membership' }, { status: 500 })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Reuse the web notify path (bell + full-entry email). Best-effort/never throws.
  await notifyDiaryEntryCreated({
    entryId: entry.id,
    projectId: entry.project_id,
    authorId: entry.created_by ?? user.id,
  })

  return NextResponse.json({ ok: true })
}
