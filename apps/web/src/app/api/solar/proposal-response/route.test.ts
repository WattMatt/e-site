import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ respond: vi.fn(), notify: vi.fn(async () => {}), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/solar/proposals/client', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/client')>()), respondByToken: h.respond }))
vi.mock('@/lib/solar/proposals/notify', () => ({ notifyProposalResponse: h.notify }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
import { POST } from './route'

const TOKEN = 'A'.repeat(43)
const req = (body: unknown, headers: Record<string, string> = {}) => new Request('http://x/api/solar/proposal-response', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'agent', ...headers }, body: JSON.stringify(body),
})
const body = { token: TOKEN, decision: 'accepted', name: 'Client Name', email: 'c@acme.example', authority: true, signature: null, reason: null, ip: '6.6.6.6' }

beforeEach(() => { vi.clearAllMocks(); h.respond.mockResolvedValue({ ok: true, state: 'accepted', projectId: 'proj1', issuedBy: 'u1', version: 2 }) })

describe('POST /api/solar/proposal-response (public, token in the body)', () => {
  it('stamps IP/UA from the REQUEST headers, never from the body', async () => {
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect(h.respond).toHaveBeenCalledWith(TOKEN, { decision: 'accepted', name: 'Client Name', email: 'c@acme.example', authority: true, signature: null, reason: null }, { ip: '203.0.113.7', ua: 'agent' })
  })
  it('notifies the proposer, audits without a user, emits the event', async () => {
    await POST(req(body))
    expect(h.notify).toHaveBeenCalledWith({ projectId: 'proj1', issuedBy: 'u1', version: 2, decision: 'accepted', actorName: 'Client Name' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: 'proj1', actorId: null, verb: 'proposal_accepted', objectRef: { version: 2, via: 'token' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: null, projectId: 'proj1', event: 'solar_proposal_responded', properties: { decision: 'accepted', via: 'token' } })
  })
  it('400 on a malformed body or a non-token string (no lookup); 422 with the sentence on a refusal; 429 when rate-limited', async () => {
    expect((await POST(req({ token: TOKEN }))).status).toBe(400)
    expect((await POST(req({ ...body, token: 'f'.repeat(64) }))).status).toBe(400)
    expect(h.respond).not.toHaveBeenCalled()
    h.respond.mockResolvedValue({ ok: false, error: 'This proposal has expired.' })
    const r = await POST(req(body))
    expect(r.status).toBe(422)
    await expect(r.json()).resolves.toEqual({ error: 'This proposal has expired.' })
    expect(h.notify).not.toHaveBeenCalled()
    h.rateLimit.mockReturnValueOnce(false)
    expect((await POST(req(body))).status).toBe(429)
  })
})
