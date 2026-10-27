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
        <h1 style={{ margin: '4px 0', fontSize: 22 }}>{tender.package} — {tender.title}{tender.reference ? ` (${tender.reference})` : ''}</h1>
        <div style={{ fontSize: 14 }}>
          {tender.project_name}{tender.organisation_name ? ` · issued by ${tender.organisation_name}` : ''} · {tender.status}
          {tender.closing_at && ` · closes ${new Date(tender.closing_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })}`}
        </div>
      </div>

      {(tender.description || tender.site_inspection || tender.queries_close_at || tender.validity_days || tender.contact_name || tender.contact_email) && (
        <Card>
          <CardHeader><span className="data-panel-title">Tender particulars</span></CardHeader>
          <CardBody>
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0, fontSize: 14 }}>
              {tender.description && (<div style={{ display: 'contents' }}><dt style={{ fontWeight: 600 }}>Scope of work</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tender.description}</dd></div>)}
              {tender.site_inspection && (<div style={{ display: 'contents' }}><dt style={{ fontWeight: 600 }}>Site inspection</dt><dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tender.site_inspection}</dd></div>)}
              {tender.queries_close_at && (<div style={{ display: 'contents' }}><dt style={{ fontWeight: 600 }}>Queries by</dt><dd style={{ margin: 0 }}>{new Date(tender.queries_close_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })} (a question asked after this is answered at the engineer&rsquo;s discretion)</dd></div>)}
              {tender.validity_days != null && (<div style={{ display: 'contents' }}><dt style={{ fontWeight: 600 }}>Validity of offers</dt><dd style={{ margin: 0 }}>{tender.validity_days} days after closing</dd></div>)}
              {(tender.contact_name || tender.contact_email) && (<div style={{ display: 'contents' }}><dt style={{ fontWeight: 600 }}>Queries contact</dt><dd style={{ margin: 0 }}>{[tender.contact_name, tender.contact_email].filter(Boolean).join(' · ')}</dd></div>)}
            </dl>
          </CardBody>
        </Card>
      )}

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
