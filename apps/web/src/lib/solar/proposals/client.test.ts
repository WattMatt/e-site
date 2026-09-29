import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ svc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
import { loadProposalByToken, respondByToken, signedProposalPdfUrl, RESPONSE_ERRORS, loadPortalProposals, respondPortal } from './client'
import { fakeSupabase } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'
import { proposalSnapshot } from '@/test/proposal-fixture'
import { toClientSnapshot } from '@esite/shared/solar-reports'

const TOKEN = 'A'.repeat(43)
const stored = { state: 'viewed', proposalId: 'p1', projectId: 'proj1', version: 2, expiresAt: '2026-10-29T08:00:00Z', snapshot: proposalSnapshot(), pdfSha256: 'a'.repeat(64), pdfPath: 'o/p/x.pdf', response: null }
let fake: ReturnType<typeof withStorage>
beforeEach(() => {
  vi.clearAllMocks()
  fake = withStorage(fakeSupabase({ rpc: {
    solar_proposal_by_token: { data: stored, error: null },
    solar_proposal_respond_by_token: { data: { ok: true, state: 'accepted', proposalId: 'p1', projectId: 'proj1', issuedBy: 'u1', version: 2 }, error: null },
    solar_portal_proposals: { data: [{ proposalId: 'p1', version: 2, state: 'viewed' }], error: null },
    solar_portal_respond: { data: { ok: false, error: 'expired' }, error: null },
  } }))
  h.svc.mockReturnValue(fake.client)
})

describe('loadProposalByToken', () => {
  it('never calls the database for a string that is not token-shaped', async () => {
    await expect(loadProposalByToken('a'.repeat(64), { ip: null, ua: null })).resolves.toMatchObject({ view: { state: 'not_found', snapshot: null } })
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })
  it('passes the RAW token + server-stamped ip/ua to the service function; strips internal fields from the view', async () => {
    const r = await loadProposalByToken(TOKEN, { ip: '203.0.113.7', ua: 'agent' })
    expect(fake.client.rpc).toHaveBeenCalledWith('solar_proposal_by_token', { p_token: TOKEN, p_ip: '203.0.113.7', p_ua: 'agent' })
    expect(r.view).toEqual({ state: 'viewed', version: 2, expiresAt: '2026-10-29T08:00:00Z', snapshot: toClientSnapshot(proposalSnapshot()), issuer: proposalSnapshot().issuer, response: null })
    expect(JSON.stringify(r.view)).not.toContain('pdfPath')
    expect(JSON.stringify(r.view)).not.toContain('projectId')
    expect(r.pdfPath).toBe('o/p/x.pdf')
  })

  it('serialises no case, provenance, proposal id, family id, run id or hash to the browser (review I3)', async () => {
    const r = await loadProposalByToken(TOKEN, { ip: null, ua: null })
    const snap = r.view.snapshot as unknown as Record<string, unknown>
    expect(snap).not.toHaveProperty('case')
    expect(snap).not.toHaveProperty('provenance')
    expect(snap.proposal).not.toHaveProperty('id')
    expect(snap.proposal).not.toHaveProperty('familyId')
    const json = JSON.stringify(r.view)
    for (const needle of ['familyId', 'runId', 'inputsHash', 'financeInputsHash', 'pdfSha256', 'a'.repeat(64), 'b'.repeat(64), '"p1"', '"c1"', '"r1"']) {
      expect(json).not.toContain(needle)
    }
  })
})

describe('respondByToken / respondPortal', () => {
  it('words a family_accepted refusal (review I2)', async () => {
    expect(RESPONSE_ERRORS.family_accepted).toBe('Another version of this proposal has already been accepted.')
  })
  it('maps success and refusals to sentences', async () => {
    await expect(respondByToken(TOKEN, { decision: 'accepted', name: 'N', email: 'e@x.co', authority: true, signature: null, reason: null }, { ip: '1', ua: 'u' }))
      .resolves.toEqual({ ok: true, state: 'accepted', projectId: 'proj1', issuedBy: 'u1', version: 2 })
    await expect(respondPortal('proj1', 'cv1', 'p1', { decision: 'accepted', name: 'N', email: 'e@x.co', authority: true, signature: null, reason: null }, { ip: null, ua: null }))
      .resolves.toEqual({ ok: false, error: RESPONSE_ERRORS.expired })
  })
  it('lists portal proposals for a verified portal user', async () => {
    await expect(loadPortalProposals('proj1', 'cv1')).resolves.toEqual([{ proposalId: 'p1', version: 2, state: 'viewed' }])
    expect(fake.client.rpc).toHaveBeenCalledWith('solar_portal_proposals', { p_project_id: 'proj1', p_user_id: 'cv1' })
  })
})

describe('signedProposalPdfUrl', () => {
  it('signs for 7 days with a download filename', async () => {
    await expect(signedProposalPdfUrl('o/p/x.pdf', 2)).resolves.toBe('https://signed.example/x')
    expect(fake.bucket.createSignedUrl).toHaveBeenCalledWith('o/p/x.pdf', 604_800, { download: 'solar-proposal-v2.pdf' })
  })
})
