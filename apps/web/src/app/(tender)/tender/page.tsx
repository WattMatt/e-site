import Link from 'next/link'
import { myTendersAction } from '@/actions/tender-portal.actions'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export const dynamic = 'force-dynamic'

export default async function MyTendersPage() {
  const res = await myTendersAction()
  const tenders = 'data' in res ? res.data : []
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Your tenders</span></CardHeader>
      <CardBody>
        {'error' in res && <p role="alert">{res.error}</p>}
        {tenders.length === 0 ? (
          <p style={{ margin: 0 }}>
            You have not accepted a tender invitation yet. Open the invitation email and press <strong>Open my invitation</strong>.
            Can&apos;t find it? <Link href="/tender/login">Ask for a fresh link</Link> to the address it was sent to.
          </p>
        ) : (
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
      </CardBody>
    </Card>
  )
}
