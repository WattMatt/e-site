import { headers } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'
import { loadProposalByToken } from '@/lib/solar/proposals/client'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'
import { ProposalClientView } from '@/components/solar/proposal/ProposalClientView'

export const dynamic = 'force-dynamic'

/**
 * A client opens an issued proposal by secure link (spec §9.4). The token is hashed IN SQL by a
 * service-only definer function; only the frozen snapshot comes back. Rate-limited per IP.
 * Opening it marks the proposal "viewed" (once) with the stamped IP/UA.
 */
export default async function ProposalTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  const ip = clientIp(h)
  if (!rateLimit(`solar-proposal-view:${ip ?? 'unknown'}`, 60, 60_000)) {
    return <p>Too many requests — wait a minute and reload.</p>
  }
  const { view } = await loadProposalByToken(token, { ip, ua: userAgent(h) })
  return <ProposalClientView mode={{ kind: 'token', token }} view={view} />
}
