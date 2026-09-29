import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ filter: vi.fn(async (_c: unknown, e: string[]) => ({ allowed: e, suppressed: [] })), notify: vi.fn(async () => {}), enabled: vi.fn(async () => false), svc: vi.fn() }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), filterSuppressed: h.filter }))
vi.mock('@/lib/solar/notify', () => ({ notifySolarUsers: h.notify }))
vi.mock('./email-toggle', () => ({ solarEmailEnabled: h.enabled }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
import { notifyProposalResponse, sendProposalToClients } from './notify'
import { fakeSupabase } from '@/test/fake-supabase'

const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  h.svc.mockReturnValue(fakeSupabase({ tables: { 'public.profiles': [{ id: 'u1', email: 'pat@sun.example', full_name: 'Pat' }], 'projects.projects': [{ id: 'p1', name: 'Acme Mall' }] } }).client)
})

describe('sendProposalToClients', () => {
  it('sends one branded email with the link, never the token hash, and HTML-escapes names', async () => {
    const n = await sendProposalToClients({ emails: ['c@acme.example'], projectName: 'Acme <Mall>', orgName: 'Sun Co', link: 'https://www.e-site.live/proposal/TOKEN', validUntil: '2026-10-29T08:00:00Z', accent: null })
    expect(n).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, { body: string }]
    expect(url).toBe('https://sb.test/functions/v1/send-email')
    const body = JSON.parse(init.body) as { payload: { to: string[]; subject: string; html: string } }
    expect(body.payload.to).toEqual(['c@acme.example'])
    expect(body.payload.html).toContain('https://www.e-site.live/proposal/TOKEN')
    expect(body.payload.html).toContain('Acme &lt;Mall&gt;')
    expect(body.payload.html).toContain('2026-10-29')
  })
  it('sends nothing for an empty list', async () => {
    await expect(sendProposalToClients({ emails: [], projectName: 'A', orgName: 'S', link: 'x', validUntil: '2026-10-29', accent: null })).resolves.toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('notifyProposalResponse', () => {
  it('bells the issuer; emails only when the project toggle is on', async () => {
    await notifyProposalResponse({ projectId: 'p1', issuedBy: 'u1', version: 2, decision: 'accepted', actorName: 'Client Name' })
    expect(h.notify).toHaveBeenCalledWith(['u1'], ['pat@sun.example'], expect.objectContaining({
      type: 'solar_proposal_accepted', title: 'Proposal v2 accepted', body: 'Client Name accepted proposal v2 for Acme Mall.', route: '/projects/p1/solar/reports', email: false,
    }))
    h.enabled.mockResolvedValueOnce(true)
    await notifyProposalResponse({ projectId: 'p1', issuedBy: 'u1', version: 2, decision: 'declined', actorName: 'Client Name' })
    expect(h.notify).toHaveBeenLastCalledWith(['u1'], ['pat@sun.example'], expect.objectContaining({ type: 'solar_proposal_declined', email: true }))
  })
  it('does nothing without an issuer', async () => {
    await notifyProposalResponse({ projectId: 'p1', issuedBy: null, version: 1, decision: 'accepted', actorName: 'X' })
    expect(h.notify).not.toHaveBeenCalled()
  })
})
