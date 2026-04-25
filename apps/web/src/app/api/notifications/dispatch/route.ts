/**
 * POST /api/notifications/dispatch
 *
 * Server-side proxy for the `send-notification` Edge Function. The Edge
 * Function only accepts service-role callers; mobile clients hold an
 * `authenticated` JWT and would otherwise be rejected with 403. This route
 * authenticates the caller, enforces same-org boundaries, and forwards the
 * request to the Edge Function with the service-role key.
 *
 * Auth: Authorization: Bearer <supabase access_token>
 *
 * Body:
 *   {
 *     userIds:   string[]                 // profile IDs to notify (1..50)
 *     title:     string
 *     body:      string
 *     type?:     string                   // notification.type, defaults to 'general'
 *     entityType?: string
 *     entityId?: string                   // uuid
 *     route?:    string                   // in-app deep link, becomes data.route
 *     data?:     Record<string, unknown>  // arbitrary payload, merged with route
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@esite/db'
import { rateLimit } from '@/lib/rate-limit'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const uuidSchema = z.string().uuid()

const bodySchema = z.object({
  userIds: z.array(uuidSchema).min(1).max(50),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  type: z.string().min(1).max(64).optional(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: uuidSchema.optional(),
  route: z.string().min(1).max(500).optional(),
  data: z.record(z.unknown()).optional(),
})

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
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate the JWT signature + expiry against Supabase Auth.
  const anon = createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: userErr } = await anon.auth.getUser(accessToken)
  if (userErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!rateLimit(`notify:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let parsed
  try {
    parsed = bodySchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { userIds, title, body, type, entityType, entityId, route, data } = parsed.data
  const uniqueRecipientIds = [...new Set(userIds)]

  // Cross-org check: every recipient must share an active org with the caller.
  // Use the service-role client so we read membership without RLS interference,
  // but the trust boundary is the JWT we just verified above.
  const service = createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: callerOrgsRaw, error: callerOrgsErr } = await service
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
  if (callerOrgsErr) {
    return NextResponse.json({ error: 'Failed to verify membership' }, { status: 500 })
  }
  const callerOrgIds = (callerOrgsRaw ?? []).map((r: { organisation_id: string }) => r.organisation_id)
  if (callerOrgIds.length === 0) {
    return NextResponse.json({ error: 'Forbidden: no active organisation' }, { status: 403 })
  }

  const { data: sharedRaw, error: sharedErr } = await service
    .from('user_organisations')
    .select('user_id')
    .eq('is_active', true)
    .in('user_id', uniqueRecipientIds)
    .in('organisation_id', callerOrgIds)
  if (sharedErr) {
    return NextResponse.json({ error: 'Failed to verify recipients' }, { status: 500 })
  }
  const allowedRecipientIds = [
    ...new Set((sharedRaw ?? []).map((r: { user_id: string }) => r.user_id)),
  ]
  if (allowedRecipientIds.length !== uniqueRecipientIds.length) {
    return NextResponse.json(
      { error: 'Forbidden: one or more recipients are outside your organisation' },
      { status: 403 },
    )
  }

  // Forward to the Edge Function with service-role auth.
  const mergedData: Record<string, unknown> = { ...(data ?? {}) }
  if (route && mergedData.route === undefined) mergedData.route = route

  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      userIds: allowedRecipientIds,
      title,
      body,
      type,
      entityType,
      entityId,
      data: mergedData,
    }),
  })

  const upstreamText = await upstream.text()
  return new NextResponse(upstreamText, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  })
}
