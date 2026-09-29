'use server'
/**
 * Portal users (client viewers on the project) accept / decline / download an issued proposal
 * (spec §9.4, D-18 "portal users also see them in the portal"). Gate: requirePortalAccess — the same
 * gate the portal layout runs. The service-only SQL function re-checks portal membership itself.
 */
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requirePortalAccess } from '@/lib/portal/data'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { loadPortalProposal, parseResponseBody, respondPortal, signedProposalPdfUrl } from '@/lib/solar/proposals/client'
import { notifyProposalResponse } from '@/lib/solar/proposals/notify'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'

const NO_ACCESS = 'You do not have access to this project.'

export async function respondToPortalProposalAction(input: {
  projectId: string; proposalId: string; decision: 'accepted' | 'declined'; name: string; email: string
  authority: boolean; signature: string | null; reason: string | null
}): Promise<{ ok: true; state: 'accepted' | 'declined' } | { error: string }> {
  const access = await requirePortalAccess(input.projectId)
  if (!access) return { error: NO_ACCESS }
  const body = parseResponseBody(input)
  if (!body) return { error: 'Something went wrong — try again.' }
  if (!rateLimit(`solar-portal-respond:${access.userId}`, 5, 10 * 60_000)) return { error: 'Too many attempts — wait a few minutes and try again.' }
  const h = await headers()
  const r = await respondPortal(input.projectId, access.userId, input.proposalId, body, { ip: clientIp(h), ua: userAgent(h) })
  if (!r.ok) return { error: r.error }
  await notifyProposalResponse({ projectId: r.projectId, issuedBy: r.issuedBy, version: r.version, decision: r.state, actorName: body.name.trim() })
  await recordSolarAudit({ projectId: r.projectId, actorId: access.userId, verb: r.state === 'accepted' ? 'proposal_accepted' : 'proposal_declined', objectRef: { version: r.version, via: 'portal' } })
  await emitProductEvent({ actorId: access.userId, projectId: r.projectId, event: 'solar_proposal_responded', properties: { decision: r.state, via: 'portal' } })
  revalidatePath(`/portal/${input.projectId}/proposals`)
  return { ok: true, state: r.state }
}

export async function getPortalProposalPdfUrlAction(input: { projectId: string; proposalId: string }): Promise<{ url: string } | { error: string }> {
  const access = await requirePortalAccess(input.projectId)
  if (!access) return { error: NO_ACCESS }
  const h = await headers()
  const { view, pdfPath } = await loadPortalProposal(input.projectId, access.userId, input.proposalId, { ip: clientIp(h), ua: userAgent(h) })
  if (!['viewed', 'accepted', 'declined'].includes(view.state) || !pdfPath || view.version === null) return { error: 'This proposal is no longer available.' }
  const url = await signedProposalPdfUrl(pdfPath, view.version)
  return url ? { url } : { error: 'The PDF could not be prepared — try again.' }
}
