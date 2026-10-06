/**
 * POST /api/internal/whatsapp/reports — on-demand reports for WhatsApp (sub-project 4).
 *
 * Called ONLY by the whatsapp-webhook / whatsapp-worker edge functions, exactly like
 * /api/internal/whatsapp/forms: an HMAC over the raw body with WHATSAPP_INTERNAL_SECRET
 * (verifyInternal, 5-minute skew), no session, on the middleware's signed-path list. A
 * missing secret refuses everything. The person is gated inside buildCableSchedulePdfForUser
 * (getExportPolicy -> user_effective_project_role, site-scoped since 00238).
 * A 5xx makes the edge leave the message pending, and claim_inbound retries it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { verifyInternal } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { buildCableSchedulePdfForUser } from '@/lib/whatsapp-reports/cable-schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNATURE_HEADER = 'x-esite-wa-signature'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ok = await verifyInternal(process.env.WHATSAPP_INTERNAL_SECRET ?? '', req.headers.get(SIGNATURE_HEADER), raw,
    Math.floor(Date.now() / 1000))
  if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let body: { op?: unknown; userId?: unknown; projectId?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  if (body.op !== 'cable_schedule') return NextResponse.json({ error: 'unknown op' }, { status: 400 })
  if (typeof body.userId !== 'string' || !UUID.test(body.userId) || typeof body.projectId !== 'string' || !UUID.test(body.projectId)) {
    return NextResponse.json({ error: 'userId and projectId must be UUIDs' }, { status: 400 })
  }

  try {
    const out = await buildCableSchedulePdfForUser(createServiceClient(), body.userId, body.projectId)
    if (out.code !== 'ok') return NextResponse.json({ code: out.code, message: out.message })
    return NextResponse.json({ code: 'ok', filename: out.filename, base64: Buffer.from(out.bytes).toString('base64') })
  } catch (e) {
    console.error('[whatsapp-reports] cable_schedule failed', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
