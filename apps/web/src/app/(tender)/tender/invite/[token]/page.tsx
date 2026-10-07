import { redirect } from 'next/navigation'
import { previewInvitationAction } from '@/actions/tender-portal.actions'
import { createClient } from '@/lib/supabase/server'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { INVITATION_REFUSAL_TEXT } from '@/lib/tender/invitation'
import { AcceptInvitation } from '../../../_components/AcceptInvitation'
import { ContinueToTenders } from '../../../_components/ContinueToTenders'

export const dynamic = 'force-dynamic'

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ k?: string; t?: string }>
}) {
  const { token } = await params
  const { k, t } = await searchParams
  const access = k && t ? { k, t } : null
  const res = await previewInvitationAction(token)
  if ('error' in res) {
    // Already accepted (accepting clears the link, so it reads as not found too):
    // never a dead end. Signed in → straight to the tenders; from an email link →
    // one button that uses it; otherwise → the return-visit page.
    if (res.error === INVITATION_REFUSAL_TEXT.used || res.error === INVITATION_REFUSAL_TEXT.not_found) {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) redirect('/tender')
      return (
        <Card>
          <CardHeader><span className="data-panel-title">Tender invitation</span></CardHeader>
          <CardBody>
            <p style={{ marginTop: 0 }}>
              {res.error === INVITATION_REFUSAL_TEXT.used
                ? 'You have already accepted this invitation.'
                : 'This invitation link has already been used. If you accepted the invitation, continue to your tenders.'}
            </p>
            <ContinueToTenders access={access} />
          </CardBody>
        </Card>
      )
    }
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Tender invitation</span></CardHeader>
        <CardBody>
          <p role="alert">{res.error}</p>
        </CardBody>
      </Card>
    )
  }
  const p = res.data
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Invitation to tender</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 10, fontSize: 15 }}>
          <p style={{ margin: 0 }}>
            <strong>{p.organisationName}</strong> invites <strong>{p.companyName}</strong> to tender for
            {' '}<strong>{p.package} — {p.title}</strong>{p.projectName ? ` on ${p.projectName}` : ''}.
          </p>
          {p.closingAt && (
            <p style={{ margin: 0 }}>
              Tenders close <strong>{new Date(p.closingAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })}</strong>.
            </p>
          )}
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-muted)' }}>
            You will see the bill of quantities and the documents requested, and only ever your own prices. Nobody at the engineer&apos;s
            office can see your prices before the closing time.
          </p>
          <AcceptInvitation token={token} email={p.email} canAccept={p.canAccept} signedInAs={p.signedInAs} access={access} />
        </div>
      </CardBody>
    </Card>
  )
}
