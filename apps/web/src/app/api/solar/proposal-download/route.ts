/**
 * Public 7-day signed download of an issued proposal PDF, by secure link (token in the body).
 * Rate-limited per IP; a string that is not token-shaped is refused before any lookup.
 */
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { loadProposalByToken, signedProposalPdfUrl } from '@/lib/solar/proposals/client'
import { isShareToken } from '@/lib/solar/proposals/token'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'

export const runtime = 'nodejs'
const READABLE = new Set(['viewed', 'accepted', 'declined'])

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  if (!rateLimit(`solar-proposal-download:${ip ?? 'unknown'}`, 20, 60_000)) return NextResponse.json({ error: 'Too many requests — wait a minute.' }, { status: 429 })
  const raw = await req.json().catch(() => null) as { token?: unknown } | null
  if (!isShareToken(raw?.token)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { view, pdfPath } = await loadProposalByToken(raw.token, { ip, ua: userAgent(req.headers) })
  if (!READABLE.has(view.state) || !pdfPath || view.version === null) return NextResponse.json({ error: 'This proposal is no longer available.' }, { status: 410 })
  const url = await signedProposalPdfUrl(pdfPath, view.version)
  if (!url) return NextResponse.json({ error: 'The PDF could not be prepared — try again.' }, { status: 500 })
  return NextResponse.json({ url })
}
