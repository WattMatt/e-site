import type { Metadata } from 'next'
import { optOutMarketingEmailsAction } from '@/actions/unsubscribe.actions'
import { H1, P } from '@/components/layout/LegalPlaceholder'
import { OptBackInButton } from './OptBackInButton'

export const metadata: Metadata = {
  title: 'Unsubscribe — E-Site',
  description: 'Opt out of E-Site lifecycle emails.',
}

// Server component. Running the opt-out as part of the page render gives
// one-click unsubscribe (no "click to confirm" extra step). This is the human
// path — the recipient clicking the footer link; the mailbox provider's own
// Unsubscribe control POSTs to /api/unsubscribe instead (RFC 8058), and both
// call the same writer.
//
// ⚠ This page was 307'd to /login for every anonymous visitor until 2026-09,
// i.e. for every recipient who clicked it from an inbox. It is public because
// middleware.ts lists it in LEGAL_PREFIXES; it must also stay out of the
// signed-in bounce, the unconfirmed-email gate and the MFA gate, all of which
// would send a dormant recipient somewhere other than here. middleware.test.ts
// enumerates app/(legal) from disk and pins all four.
//
// `!result.ok` now covers the case that used to render as success: an UPDATE
// that matched zero rows. Never tell someone they are unsubscribed on the
// strength of a write that changed nothing.
//
// Spec: spec-v2.md §19 (POPIA consent revocation + anti-spam compliance).

// The opt-out is a write; it must never be served from a cache, and the
// rendered confirmation is specific to one ?user.
export const dynamic = 'force-dynamic'

export default async function UnsubscribePage(props: {
  searchParams: Promise<{ user?: string }>
}) {
  const { user } = await props.searchParams

  if (!user) {
    return (
      <div>
        <H1>Unsubscribe</H1>
        <P>
          This link is missing the information we need to identify your account. If you got here
          by following an E-Site email link, please try again or email
          {' '}<a href="mailto:hello@e-site.live" style={{ color: 'var(--c-text-mid)' }}>hello@e-site.live</a>.
        </P>
      </div>
    )
  }

  const result = await optOutMarketingEmailsAction(user)

  if (!result.ok) {
    return (
      <div>
        <H1>Unsubscribe</H1>
        <P>{result.error ?? 'Something went wrong.'}</P>
      </div>
    )
  }

  return (
    <div>
      <H1>You&apos;re unsubscribed</H1>
      <P>
        {result.email
          ? `We won't send lifecycle or re-engagement emails to ${result.email} any more.`
          : 'We won\u2019t send lifecycle or re-engagement emails to this address any more.'}
      </P>
      <P>
        Transactional emails (billing confirmations, security alerts, and emails about account
        state) will still be sent — they&apos;re not part of the marketing list.
      </P>
      <P>Changed your mind? Happens to the best of us.</P>
      <OptBackInButton userId={user} />
    </div>
  )
}
