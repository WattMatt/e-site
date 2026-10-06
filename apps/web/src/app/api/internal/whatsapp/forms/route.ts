/**
 * POST /api/internal/whatsapp/forms — the WhatsApp inspection-form service (E4).
 *
 * Called ONLY by the whatsapp-webhook / whatsapp-worker edge functions. Authenticated by an
 * HMAC over the raw body with WHATSAPP_INTERNAL_SECRET (verifyInternal, 5-minute skew); no
 * session, no cookies, and it is on the middleware's signed-path list for that reason. A
 * missing secret refuses everything. Access to the inspection is decided per call by
 * whatsapp.wa_inspection_* acting as the person (see lib/whatsapp-forms/service.ts).
 * A 5xx makes the edge leave the message pending, and claim_inbound retries it.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { verifyInternal } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { FORMS_OPS, handleFormsOp, sha256Hex, type FormsOp } from '@/lib/whatsapp-forms/service'
import { createFormsStore } from '@/lib/whatsapp-forms/store'
import { afterWhatsAppSubmit } from '@/lib/whatsapp-forms/after-submit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNATURE_HEADER = 'x-esite-wa-signature'

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ok = await verifyInternal(process.env.WHATSAPP_INTERNAL_SECRET ?? '', req.headers.get(SIGNATURE_HEADER), raw,
    Math.floor(Date.now() / 1000))
  if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const op = body.op as FormsOp
  if (!FORMS_OPS.includes(op)) return NextResponse.json({ error: 'unknown op' }, { status: 400 })

  try {
    const reply = await handleFormsOp(op, body, {
      store: createFormsStore(createServiceClient()),
      now: () => new Date(),
      appUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://www.e-site.live',
      afterSubmit: (sessionId, opts) => afterWhatsAppSubmit(sessionId, opts),
      newToken: () => randomBytes(32).toString('base64url'),
      hash: sha256Hex,
    })
    return NextResponse.json(reply)
  } catch (e) {
    console.error('[whatsapp-forms] op failed', op, e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
