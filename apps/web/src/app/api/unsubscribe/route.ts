/**
 * One-click unsubscribe endpoint (RFC 8058).
 *
 * The mailbox provider — Gmail, Outlook, Yahoo — renders its own "Unsubscribe"
 * control when a message carries `List-Unsubscribe` + `List-Unsubscribe-Post`,
 * and honours it by POSTing `List-Unsubscribe=One-Click` to this URL with NO
 * session and NO user interaction beyond the click. A Next.js `page.tsx`
 * cannot serve that: page routes answer GET only, so a POST to
 * /unsubscribe?user=… returns 405 and the provider records the one-click as
 * failed. Hence a real route handler.
 *
 * This is the reason the headers are not decorative. The in-page GET flow at
 * /unsubscribe?user=… stays as-is for humans clicking the footer link; both
 * paths call the SAME writer (optOutMarketingEmailsAction), so there is one
 * place where public.profiles.marketing_emails_opted_out is set and one place
 * that can regress.
 *
 * Auth: none, by design — the v4 auth UUID is the bearer. See the header of
 * actions/unsubscribe.actions.ts for the POPIA §69(3)/§11(3) + ECTA §45
 * reasoning and the blast-radius argument.
 *
 * Bypassed in middleware.ts via PUBLIC_API_PATHS; without that a provider's
 * POST is 307'd to /login and the one-click silently never works.
 */

import { NextRequest, NextResponse } from 'next/server'
import { optOutMarketingEmailsAction } from '@/actions/unsubscribe.actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Missing user.' }, { status: 400 })
  }

  const result = await optOutMarketingEmailsAction(userId)
  if (!result.ok) {
    // 422, not 200: a provider that is told "unsubscribed" when nothing was
    // written is the exact failure this whole change exists to end.
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}

// A provider (or a curious human) issuing GET gets the human page, which runs
// the same opt-out and renders confirmation.
export function GET(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/unsubscribe'
  return NextResponse.redirect(url, 303)
}
