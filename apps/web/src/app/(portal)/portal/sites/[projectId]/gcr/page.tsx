import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getClientGcrReviewAction,
  getClientReviewNodesAction,
  getClientSitesAction,
} from '../../../../portal-gcr.actions'
import { ClientGcrReview } from './ClientGcrReview'

export default async function ClientGcrPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  // Both reads are grant-gated (the RPC raises for an ungranted client). Run in
  // parallel: the outputs-only payload + the shopNumber->live-node map a captured
  // proposal must target + the granted-site list (for org co-branding the header).
  const [reviewRes, nodesRes, sitesRes] = await Promise.all([
    getClientGcrReviewAction(projectId),
    getClientReviewNodesAction(projectId),
    getClientSitesAction(),
  ])

  const site = Array.isArray(sitesRes)
    ? sitesRes.find((s) => s.project_id === projectId)
    : undefined
  const orgName = site?.organisation_name ?? null
  const siteName = site?.project_name ?? null

  // Not authorised (no grant) -> 404, don't leak that the site exists.
  if ('error' in reviewRes) notFound()

  if (!reviewRes.payload) {
    return (
      <div>
        <Link href="/portal/sites" style={backLink}>← My sites</Link>
        <CoBrandHeader orgName={orgName} siteName={siteName} />
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          No review has been published for this site yet. Your project team will share
          one when it is ready.
        </p>
      </div>
    )
  }

  const nodeIdByShop = 'error' in nodesRes ? {} : nodesRes.nodeIdByShop

  return (
    <div>
      <Link href="/portal/sites" style={backLink}>← My sites</Link>
      <CoBrandHeader orgName={orgName} siteName={siteName} />
      <ClientGcrReview projectId={projectId} payload={reviewRes.payload} nodeIdByShop={nodeIdByShop} />
    </div>
  )
}

/** Org-co-branded header: org name + WM amber accent rule, site + section title. */
function CoBrandHeader({ orgName, siteName }: { orgName: string | null; siteName: string | null }) {
  return (
    <div style={{ margin: '12px 0 16px', borderLeft: '3px solid var(--c-amber)', paddingLeft: 12 }}>
      {orgName && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-amber)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {orgName}
        </div>
      )}
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: '2px 0 0' }}>
        {siteName ? `${siteName} — generator cost recovery` : 'Generator cost recovery — review'}
      </h1>
    </div>
  )
}

const backLink: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--c-text-dim)',
  textDecoration: 'none',
}
