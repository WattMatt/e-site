import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getClientGcrReviewAction, getClientReviewNodesAction } from '../../../../portal-gcr.actions'
import { ClientGcrReview } from './ClientGcrReview'

export default async function ClientGcrPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  // Both reads are grant-gated (the RPC raises for an ungranted client). Run in
  // parallel: the outputs-only payload + the shopNumber->live-node map a captured
  // proposal must target.
  const [reviewRes, nodesRes] = await Promise.all([
    getClientGcrReviewAction(projectId),
    getClientReviewNodesAction(projectId),
  ])

  // Not authorised (no grant) -> 404, don't leak that the site exists.
  if ('error' in reviewRes) notFound()

  if (!reviewRes.payload) {
    return (
      <div>
        <Link href="/portal/sites" style={backLink}>← My sites</Link>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: '12px 0' }}>
          Generator cost recovery
        </h1>
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
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: '12px 0 16px' }}>
        Generator cost recovery — review
      </h1>
      <ClientGcrReview projectId={projectId} payload={reviewRes.payload} nodeIdByShop={nodeIdByShop} />
    </div>
  )
}

const backLink: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--c-text-dim)',
  textDecoration: 'none',
}
