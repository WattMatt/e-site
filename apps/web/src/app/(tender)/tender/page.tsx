import Link from 'next/link'
import { myTendersAction, pendingInvitationsAction } from '@/actions/tender-portal.actions'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PendingInvitations } from '../_components/PendingInvitations'

export const dynamic = 'force-dynamic'

export default async function MyTendersPage() {
  const [res, pendingRes] = await Promise.all([myTendersAction(), pendingInvitationsAction()])
  const tenders = 'data' in res ? res.data : []
  const pending = 'data' in pendingRes ? pendingRes.data : []
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Your tenders</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 16 }}>
          {'error' in res && <p role="alert">{res.error}</p>}
          {pending.length > 0 && <PendingInvitations invitations={pending} />}
          {tenders.length === 0 && pending.length === 0 && (
            <p style={{ margin: 0 }}>
              You have no tender invitations at the moment. If you expected one, check that you opened the email sent to this address,
              or <Link href="/tender/login">ask for a fresh link</Link> to the address the invitation went to.
            </p>
          )}
          {tenders.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {tenders.map((t) => (
                <li key={t.id} style={{ border: '1px solid var(--c-border, #e2e8f0)', borderRadius: 8, padding: 12 }}>
                  <Link href={`/tender/${t.id}`} style={{ fontWeight: 600 }}>{t.package} — {t.title}</Link>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    {t.project_name} · {t.company_name} · {t.status}
                    {t.closing_at && ` · closes ${new Date(t.closing_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`}
                    {!t.profile_completed_at && ' · company details needed'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
