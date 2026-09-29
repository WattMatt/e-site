import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ access: vi.fn(), respond: vi.fn(), load: vi.fn(), sign: vi.fn(async () => 'https://signed.example/x'), notify: vi.fn(async () => {}), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), rateLimit: vi.fn(() => true), headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '198.51.100.9', 'user-agent': 'portal-agent' })) }))
vi.mock('@/lib/portal/data', () => ({ requirePortalAccess: h.access }))
vi.mock('@/lib/solar/proposals/client', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/client')>()), respondPortal: h.respond, loadPortalProposal: h.load, signedProposalPdfUrl: h.sign }))
vi.mock('@/lib/solar/proposals/notify', () => ({ notifyProposalResponse: h.notify }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/headers', () => ({ headers: h.headers }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
import { respondToPortalProposalAction, getPortalProposalPdfUrlAction } from './solar-portal-proposals.actions'

const body = { decision: 'accepted' as const, name: 'Client Viewer', email: 'cv@acme.example', authority: true, signature: null, reason: null }
beforeEach(() => { vi.clearAllMocks(); h.rateLimit.mockReturnValue(true); h.access.mockResolvedValue({ userId: 'cv1', organisationId: 'o1', projectId: 'p1' }) })

describe('portal proposal actions', () => {
  it('refuse anyone who is not a portal member of the project', async () => {
    h.access.mockResolvedValue(null)
    await expect(respondToPortalProposalAction({ projectId: 'p1', proposalId: 'pr1', ...body })).resolves.toEqual({ error: 'You do not have access to this project.' })
    await expect(getPortalProposalPdfUrlAction({ projectId: 'p1', proposalId: 'pr1' })).resolves.toEqual({ error: 'You do not have access to this project.' })
    expect(h.respond).not.toHaveBeenCalled()
    expect(h.load).not.toHaveBeenCalled()
  })
  it('respond passes the VERIFIED user id and header-stamped ip/ua', async () => {
    h.respond.mockResolvedValue({ ok: true, state: 'accepted', projectId: 'p1', issuedBy: 'u1', version: 3 })
    await expect(respondToPortalProposalAction({ projectId: 'p1', proposalId: 'pr1', ...body })).resolves.toEqual({ ok: true, state: 'accepted' })
    expect(h.respond).toHaveBeenCalledWith('p1', 'cv1', 'pr1', body, { ip: '198.51.100.9', ua: 'portal-agent' })
    expect(h.notify).toHaveBeenCalledWith({ projectId: 'p1', issuedBy: 'u1', version: 3, decision: 'accepted', actorName: 'Client Viewer' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: 'p1', actorId: 'cv1', verb: 'proposal_accepted', objectRef: { version: 3, via: 'portal' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'cv1', projectId: 'p1', event: 'solar_proposal_responded', properties: { decision: 'accepted', via: 'portal' } })
  })
  it('a refusal is worded and nobody is notified; rate-limited per portal user', async () => {
    h.respond.mockResolvedValue({ ok: false, error: 'This proposal has expired.' })
    await expect(respondToPortalProposalAction({ projectId: 'p1', proposalId: 'pr1', ...body })).resolves.toEqual({ error: 'This proposal has expired.' })
    expect(h.notify).not.toHaveBeenCalled()
    h.rateLimit.mockReturnValueOnce(false)
    await expect(respondToPortalProposalAction({ projectId: 'p1', proposalId: 'pr1', ...body })).resolves.toEqual({ error: 'Too many attempts — wait a few minutes and try again.' })
    expect(h.rateLimit).toHaveBeenLastCalledWith('solar-portal-respond:cv1', 5, 600_000)
  })
  it('download signs 7 days only for a readable proposal', async () => {
    h.load.mockResolvedValue({ view: { state: 'viewed', version: 3 }, pdfPath: 'o/p/x.pdf' })
    await expect(getPortalProposalPdfUrlAction({ projectId: 'p1', proposalId: 'pr1' })).resolves.toEqual({ url: 'https://signed.example/x' })
    expect(h.load).toHaveBeenCalledWith('p1', 'cv1', 'pr1', { ip: '198.51.100.9', ua: 'portal-agent' })
    expect(h.sign).toHaveBeenCalledWith('o/p/x.pdf', 3)
    h.load.mockResolvedValue({ view: { state: 'expired', version: 3 }, pdfPath: null })
    await expect(getPortalProposalPdfUrlAction({ projectId: 'p1', proposalId: 'pr1' })).resolves.toEqual({ error: 'This proposal is no longer available.' })
  })
})
