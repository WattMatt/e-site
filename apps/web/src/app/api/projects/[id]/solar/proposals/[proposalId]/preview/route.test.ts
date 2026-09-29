import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Pat', email: 'pat@x' } }) }) }) }) })), gate: vi.fn(), prepare: vi.fn(), brand: vi.fn(async () => ({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'A' })), render: vi.fn(async () => Buffer.from('%PDF-preview')), rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/proposals/prepare', () => ({ prepareProposalSnapshot: h.prepare }))
vi.mock('@/lib/solar/reports/branding-loader', () => ({ loadSolarBrandingData: h.brand }))
vi.mock('@/lib/solar/reports/render-proposal', () => ({ renderProposalPdf: h.render }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
import { GET } from './route'
import { fakeSupabase } from '@/test/fake-supabase'
import { proposalSnapshot } from '@/test/proposal-fixture'

const P = '11111111-1111-4111-8111-111111111111', PR = '22222222-2222-4222-8222-222222222222'
const call = (id = P, proposalId = PR) => GET(new Request('http://x'), { params: Promise.resolve({ id, proposalId }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, level: 'edit_financials', userId: 'u1' })
  h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'solar.proposals': [{ id: PR, project_id: P, family_id: PR, version: 1, status: 'draft', case_id: 'c1', draft: {} }] } }).client)
  h.prepare.mockResolvedValue({ ok: true, snapshot: proposalSnapshot(), runId: 'r1' })
})

describe('GET preview', () => {
  it('gates Edit + financials first (JSON 403)', async () => {
    h.gate.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Solar access required' }), { status: 403 }) })
    expect((await call()).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith(expect.anything(), P, 'edit_financials')
    expect(h.prepare).not.toHaveBeenCalled()
  })
  it('400 on a non-UUID param', async () => {
    expect((await call('x')).status).toBe(400)
  })
  it('renders a watermarked PDF inline', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(h.render).toHaveBeenCalledWith(expect.anything(), expect.anything(), { preview: true })
  })
  it('422 with the reason when the case is Stale', async () => {
    h.prepare.mockResolvedValue({ ok: false, error: 'The selected case is stale — re-run it first.' })
    const res = await call()
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'The selected case is stale — re-run it first.' })
  })
  it('409 for an issued proposal (its frozen PDF is in the list)', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'solar.proposals': [{ id: PR, project_id: P, status: 'issued' }] } }).client)
    expect((await call()).status).toBe(409)
  })
})
