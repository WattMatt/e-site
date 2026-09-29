/**
 * Public accept / decline for a proposal opened by secure link (spec §9.4, D-18). No session: the
 * token is the bearer, carried in the BODY (never a path segment, so this is one exact public path).
 * Rate-limited per IP and per token. IP/UA are stamped from request headers here and stored by the
 * SQL function — nothing in the body can set them.
 */
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { parseResponseBody, respondByToken } from '@/lib/solar/proposals/client'
import { notifyProposalResponse } from '@/lib/solar/proposals/notify'
import { hashShareToken, isShareToken } from '@/lib/solar/proposals/token'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  const raw = await req.json().catch(() => null) as { token?: unknown } | null
  const token = raw?.token
  const body = parseResponseBody(raw)
  if (!isShareToken(token) || !body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  if (!rateLimit(`solar-proposal-respond:${ip ?? 'unknown'}`, 10, 10 * 60_000) || !rateLimit(`solar-proposal-respond-t:${hashShareToken(token)}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — wait a few minutes and try again.' }, { status: 429 })
  }
  const r = await respondByToken(token, body, { ip, ua: userAgent(req.headers) })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 })
  await notifyProposalResponse({ projectId: r.projectId, issuedBy: r.issuedBy, version: r.version, decision: r.state, actorName: body.name.trim() })
  await recordSolarAudit({ projectId: r.projectId, actorId: null, verb: r.state === 'accepted' ? 'proposal_accepted' : 'proposal_declined', objectRef: { version: r.version, via: 'token' } })
  await emitProductEvent({ actorId: null, projectId: r.projectId, event: 'solar_proposal_responded', properties: { decision: r.state, via: 'token' } })
  return NextResponse.json({ ok: true, state: r.state })
}
