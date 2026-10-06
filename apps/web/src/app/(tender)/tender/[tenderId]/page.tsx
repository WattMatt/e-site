import Link from 'next/link'
import { notFound } from 'next/navigation'
import { portalTenderAction } from '@/actions/tender-portal.actions'
import { getPricingAction } from '@/actions/tender-submission.actions'
import { PricingWorkspace } from '../../_components/PricingWorkspace'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ProfileForm } from '../../_components/ProfileForm'

export const dynamic = 'force-dynamic'

export default async function TenderPortalPage({ params }: { params: Promise<{ tenderId: string }> }) {
  const { tenderId } = await params
  const res = await portalTenderAction(tenderId)
  if ('error' in res) {
    if (res.error === 'Tender not found') notFound()
    return <p role="alert">{res.error}</p>
  }
  const { tender, profile } = res.data
  const pricing = await getPricingAction(tenderId)

  return (
    <>
      <div>
        <Link href="/tender" style={{ fontSize: 13 }}>← Your tenders</Link>
        <h1 style={{ margin: '4px 0', fontSize: 22 }}>{tender.package} — {tender.title}</h1>
        <div style={{ fontSize: 14 }}>
          {tender.project_name}{tender.organisation_name ? ` · issued by ${tender.organisation_name}` : ''} · {tender.status}
          {tender.closing_at && ` · closes ${new Date(tender.closing_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })}`}
        </div>
      </div>

      <Card>
        <CardHeader><span className="data-panel-title">1. Company details</span></CardHeader>
        <CardBody>
          <ProfileForm tenderId={tender.id} initial={profile} />
        </CardBody>
      </Card>

      {pricing && 'data' in pricing ? (
        <PricingWorkspace tenderId={tender.id} state={pricing.data} />
      ) : (
        <p role="alert">{pricing && 'error' in pricing ? pricing.error : 'Pricing is not available.'}</p>
      )}
    </>
  )
}
