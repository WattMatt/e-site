import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requirePortalAccess } from '@/lib/portal/data'
import { loadPortalProposal } from '@/lib/solar/proposals/client'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'
import { ProposalClientView } from '@/components/solar/proposal/ProposalClientView'

export const dynamic = 'force-dynamic'

/** One proposal for a portal user — the SAME view the token page renders (identical figures). */
export default async function PortalProposalPage({ params }: { params: Promise<{ projectId: string; proposalId: string }> }) {
  const { projectId, proposalId } = await params
  const access = await requirePortalAccess(projectId)
  if (!access) notFound()
  const h = await headers()
  const { view } = await loadPortalProposal(projectId, access.userId, proposalId, { ip: clientIp(h), ua: userAgent(h) })
  if (view.state === 'not_found') notFound()
  return <ProposalClientView mode={{ kind: 'portal', projectId, proposalId }} view={view} />
}
