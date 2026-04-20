import type { Metadata } from 'next'
import { optOutMarketingEmailsAction } from '@/actions/unsubscribe.actions'
import { H1, P } from '@/components/layout/LegalPlaceholder'
import { OptBackInButton } from './OptBackInButton'

export const metadata: Metadata = {
  title: 'Unsubscribe — E-Site',
  description: 'Opt out of E-Site lifecycle emails.',
}

// Server component. Running the opt-out as part of the page render gives
// one-click unsubscribe (no "click to confirm" extra step) — matches the
// expected behaviour of a List-Unsubscribe / mailto link.
//
// Spec: spec-v2.md §19 (POPIA consent revocation + anti-spam compliance).

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
          {' '}<a href="mailto:hello@e-site.co.za" style={{ color: 'var(--c-text-mid)' }}>hello@e-site.co.za</a>.
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
