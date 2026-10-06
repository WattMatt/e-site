import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { getTenderDetailAction } from '@/actions/tender.actions'
import { listInvitationsAction } from '@/actions/tender-invite.actions'
import { tenderInvitesEnabled } from '@/lib/tender/gate'
import { IssuePanel } from '../_components/IssuePanel'
import { InvitationsPanel } from '../_components/InvitationsPanel'
import { getTenderManagementAction } from '@/actions/tender-manage.actions'
import { ClarificationsPanel, RequirementsPanel, SubmissionsPanel } from '../_components/ManagePanels'
import { ImportPanel } from '../_components/ImportPanel'
import { ReconciliationView } from '../_components/ReconciliationView'
import { BoqGrid } from '../_components/BoqGrid'
import { DeleteTenderButton } from '../_components/DeleteTenderButton'
import { formatRand, tenderStatusVariant } from '../_components/format'
import { AdjudicationActions } from '../_components/AdjudicationActions'

export const dynamic = 'force-dynamic'

export default async function TenderPage({ params }: { params: Promise<{ id: string; tenderId: string }> }) {
  const { id, tenderId } = await params
  const supabase = await createClient()
  const guard = await requireEffectiveRole(supabase, id, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${id}`)

  const res = await getTenderDetailAction(tenderId)
  if ('error' in res) {
    if (res.error === 'Tender not found') notFound()
    return <p role="alert" style={{ color: 'var(--c-red)' }}>{res.error}</p>
  }
  const { tender, items, estimate } = res.data
  if (tender.project_id !== id) notFound()
  const isDraft = tender.status === 'draft'
  const invRes = await listInvitationsAction(tenderId)
  const invitations = 'data' in invRes ? invRes.data : []
  const manRes = await getTenderManagementAction(tenderId)
  const manage = 'data' in manRes ? manRes.data : null
  const sealed = tender.status === 'issued' && !!tender.closing_at && new Date(tender.closing_at) > new Date()
  const itemCount = items.filter((i) => i.kind === 'item').length

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Link href={`/projects/${id}/tenders`} style={{ fontSize: 13 }}>← Tenders</Link>
        <h1 className="page-title" style={{ marginTop: 4 }}>
          {tender.package} — {tender.title}{tender.revision ? ` (${tender.revision})` : ''}
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <Badge variant={tenderStatusVariant(tender.status)}>{tender.status}</Badge>
          {tender.source_filename && <span>BOQ: {tender.source_filename}</span>}
          {tender.estimate_filename && <span>Estimate: {tender.estimate_filename}</span>}
          {tender.stated_subtotal != null && <span>Tender subtotal {formatRand(tender.stated_subtotal)}</span>}
          {tender.reconciliation?.estimate?.subtotal && (
            <span>Internal estimate {formatRand(tender.reconciliation.estimate.subtotal.computed)}</span>
          )}
          {tender.stated_total != null && <span>Incl. VAT {formatRand(tender.stated_total)}</span>}
          {isDraft && <DeleteTenderButton tenderId={tender.id} projectId={id} />}
          {tender.status === 'issued' && tender.closing_at && new Date(tender.closing_at) <= new Date() && (
            <AdjudicationActions tenderId={tender.id} status={tender.status} />
          )}
          {(tender.status === 'closed' || tender.status === 'adjudicated') && (
            <a className="btn btn-sm" href={`/projects/${id}/tenders/${tender.id}/adjudication`}>Adjudicate bids</a>
          )}
        </div>
      </div>

      {isDraft && <ImportPanel tenderId={tender.id} hasImport={!!tender.imported_at} />}

      {isDraft && tender.imported_at && <IssuePanel tenderId={tender.id} closingAt={tender.closing_at} />}

      {manage && <RequirementsPanel tenderId={tender.id} requirements={manage.requirements} editable={isDraft} />}

      {manage && !isDraft && <SubmissionsPanel submissions={manage.submissions} publishedAddenda={manage.publishedAddenda} sealed={sealed} />}

      {manage && !isDraft && <ClarificationsPanel tenderId={tender.id} clarifications={manage.clarifications} canPublishAddendum={sealed} />}

      {(isDraft || tender.status === 'issued') && (
        <InvitationsPanel
          tenderId={tender.id}
          invitations={invitations}
          sendingEnabled={tenderInvitesEnabled()}
          open={isDraft || tender.status === 'issued'}
        />
      )}

      {tender.reconciliation && (
        <ReconciliationView
          source={tender.reconciliation.source}
          estimate={tender.reconciliation.estimate}
          diff={tender.structure_diff}
        />
      )}

      <Card>
        <CardHeader><span className="data-panel-title">Bill of quantities ({itemCount} items, {items.length} rows)</span></CardHeader>
        <CardBody>
          {items.length === 0 ? (
            <p style={{ color: 'var(--c-text-muted)' }}>Nothing imported yet.</p>
          ) : (
            <BoqGrid tenderId={tender.id} items={items} estimate={estimate} editable={isDraft} />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
