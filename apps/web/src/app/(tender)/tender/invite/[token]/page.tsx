import { previewInvitationAction } from '@/actions/tender-portal.actions'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { AcceptInvitation } from '../../../_components/AcceptInvitation'

export const dynamic = 'force-dynamic'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const res = await previewInvitationAction(token)
  if ('error' in res) {
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Tender invitation</span></CardHeader>
        <CardBody>
          <p role="alert">{res.error}</p>
          <p style={{ fontSize: 14 }}>Already accepted? <a href="/tender/login">Sign in</a> with the email address the invitation was sent to.</p>
        </CardBody>
      </Card>
    )
  }
  const p = res.data
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Invitation to tender</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 8, fontSize: 15 }}>
          <p style={{ margin: 0 }}>
            <strong>{p.organisationName}</strong> invites <strong>{p.companyName}</strong> to tender for
            {' '}<strong>{p.package} — {p.title}</strong>{p.projectName ? ` on ${p.projectName}` : ''}.
          </p>
          {p.closingAt && (
            <p style={{ margin: 0 }}>
              Tenders close {new Date(p.closingAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })}.
            </p>
          )}
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-muted)' }}>
            To accept, sign in as {p.email}: we email a link to that address. The account gives access to the tenders you are invited to
            only: you will see the bill of quantities and the documents requested, never another company&apos;s prices.
          </p>
          <AcceptInvitation token={token} email={p.email} canAccept={p.canAccept} signedInAs={p.signedInAs} />
        </div>
      </CardBody>
    </Card>
  )
}
