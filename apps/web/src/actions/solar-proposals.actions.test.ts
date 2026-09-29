import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), requireSolarLevel: vi.fn(),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), rateLimit: vi.fn(() => true),
  prepare: vi.fn(), brandData: vi.fn(), render: vi.fn(async () => Buffer.from('%PDF-proposal')),
  token: vi.fn(() => ({ token: 'T'.repeat(43), hash: 'f'.repeat(64) })), emailOn: vi.fn(async () => false), sendClients: vi.fn(async () => 0),
  narrative: vi.fn(), narrativeAvailable: vi.fn(() => true),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/proposals/prepare', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/prepare')>()), prepareProposalSnapshot: h.prepare }))
vi.mock('@/lib/solar/reports/branding-loader', () => ({ loadSolarBrandingData: h.brandData }))
vi.mock('@/lib/solar/reports/render-proposal', () => ({ renderProposalPdf: h.render }))
vi.mock('@/lib/solar/proposals/token', () => ({ newShareToken: h.token }))
vi.mock('@/lib/solar/proposals/email-toggle', () => ({ solarEmailEnabled: h.emailOn }))
vi.mock('@/lib/solar/proposals/notify', () => ({ sendProposalToClients: h.sendClients }))

import {
  createSolarProposalAction, saveSolarProposalDraftAction, deleteSolarProposalDraftAction, reviseSolarProposalAction,
  issueSolarProposalAction, withdrawSolarProposalAction, newSolarProposalLinkAction,
} from './solar-proposals.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'
import { createHash } from 'node:crypto'
import { proposalSnapshot } from '@/test/proposal-fixture'

export const P = '11111111-1111-4111-8111-111111111111'
export const PR = '22222222-2222-4222-8222-222222222222'
export const U = 'user-1'
const STALE = 'Someone else changed this — reload to see their version.'
export const goodDraft = {
  clientName: 'Acme Retail', marginPct: 15, validityDays: 30, financeOptions: ['cash'], summary: '', scope: '', priceTerms: '',
  assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '',
}

export function setupUser(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: U, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
export function setupSvc(extra: Partial<FakeOptions> = {}) {
  const svc = withStorage(fakeSupabase(extra))
  h.createServiceClient.mockReturnValue(svc.client)
  return svc
}
export { h }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_SITE_URL
  h.requireSolarLevel.mockResolvedValue('edit_financials')
  h.emailOn.mockResolvedValue(false)
  h.rateLimit.mockReturnValue(true)
  h.narrativeAvailable.mockReturnValue(true)
})

describe('createSolarProposalAction', () => {
  it('gates Edit + financials FIRST', async () => {
    setupUser(); setupSvc()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(createSolarProposalAction({ projectId: P })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
  })
  it('needs a selected case', async () => {
    setupUser({ tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', selected_case_id: null }] } }); setupSvc()
    await expect(createSolarProposalAction({ projectId: P })).resolves.toEqual({ error: 'Choose a selected case on the Overview first.' })
  })
  it('drafts from the selected case with org defaults (margin from the rate card, validity + terms from templates, enabled models)', async () => {
    const user = setupUser({
      tables: {
        'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', selected_case_id: 'c1' }],
        'projects.projects': [{ id: P, client_name: 'Acme Retail' }],
        'solar.case_financials': [{ case_id: 'c1', config: { models: { cash: { enabled: true }, debt: { enabled: false }, ppa: { enabled: true }, lease: { enabled: false } } } }],
      },
      writes: { 'solar.proposals:insert': { data: [{ id: PR, version: 1 }] } },
    })
    setupSvc({ tables: {
      'solar.org_settings': [{ organisation_id: 'o1', settings: { version: 1, values: { rc_margin_pct: 12 } } }],
      'solar.proposal_templates': [{ organisation_id: 'o1', terms_text: 'Org terms', validity_days: 45 }],
    } })
    await expect(createSolarProposalAction({ projectId: P })).resolves.toEqual({ ok: true, proposalId: PR })
    const ins = callsTo(user.calls, 'solar.proposals', 'insert')[0]!.payload as { study_id: string; case_id: string; draft: Record<string, unknown> }
    expect(ins.study_id).toBe('s1')
    expect(ins.case_id).toBe('c1')
    expect(ins.draft).toMatchObject({ clientName: 'Acme Retail', marginPct: 12, validityDays: 45, terms: 'Org terms', financeOptions: ['cash', 'ppa'] })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'proposal_created', objectRef: { proposalId: PR, version: 1 } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_proposal_created' })
  })
})

describe('saveSolarProposalDraftAction', () => {
  it('returns field errors without writing', async () => {
    const user = setupUser(); setupSvc()
    const r = await saveSolarProposalDraftAction({ projectId: P, proposalId: PR, draft: { ...goodDraft, clientName: '' }, expectedUpdatedAt: 'T0' })
    expect(r).toEqual({ fieldErrors: { clientName: 'Enter the client name' } })
    expect(user.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
  it('saves only a draft, stale-guarded, pointing it at the CURRENT selected case', async () => {
    const user = setupUser({
      tables: { 'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c2' }] },
      writes: { 'solar.proposals:update': { data: [{ updated_at: 'T1' }] } },
    }); setupSvc()
    await expect(saveSolarProposalDraftAction({ projectId: P, proposalId: PR, draft: goodDraft, expectedUpdatedAt: 'T0' })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    const up = callsTo(user.calls, 'solar.proposals', 'update')[0]!
    expect(up.payload).toEqual({ draft: goodDraft, case_id: 'c2' })
    expect(up.filters).toEqual(expect.arrayContaining([['eq', 'id', PR], ['eq', 'project_id', P], ['eq', 'status', 'draft'], ['eq', 'updated_at', 'T0']]))
  })
  it('zero rows = stale', async () => {
    setupUser({ tables: { 'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c2' }] }, writes: { 'solar.proposals:update': { data: [] } } }); setupSvc()
    await expect(saveSolarProposalDraftAction({ projectId: P, proposalId: PR, draft: goodDraft, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
  })
})

describe('deleteSolarProposalDraftAction / reviseSolarProposalAction', () => {
  it('deletes a draft only', async () => {
    const user = setupUser({ writes: { 'solar.proposals:delete': { data: [] } } }); setupSvc()
    await expect(deleteSolarProposalDraftAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'Only a draft can be deleted — withdraw an issued proposal instead.' })
    expect(callsTo(user.calls, 'solar.proposals', 'delete')[0]!.filters).toContainEqual(['eq', 'status', 'draft'])
  })
  it('revise copies the latest version’s draft into v(n+1) on the current selected case', async () => {
    const user = setupUser({
      tables: {
        'solar.proposals': [{ id: PR, project_id: P, study_id: 's1', family_id: PR, version: 1, status: 'issued', draft: goodDraft }],
        'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c3' }],
      },
      writes: { 'solar.proposals:insert': { data: [{ id: 'new', version: 2 }] } },
    }); setupSvc()
    await expect(reviseSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ ok: true, proposalId: 'new', version: 2 })
    expect(callsTo(user.calls, 'solar.proposals', 'insert')[0]!.payload).toEqual({ study_id: 's1', family_id: PR, case_id: 'c3', draft: goodDraft })
  })
  it('words the database refusals', async () => {
    setupUser({
      tables: { 'solar.proposals': [{ id: PR, project_id: P, study_id: 's1', family_id: PR, version: 1, status: 'issued', draft: goodDraft }], 'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c3' }] },
      writes: { 'solar.proposals:insert': { error: { code: '23505', message: 'proposals_one_draft_per_family' } } },
    }); setupSvc()
    await expect(reviseSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'A draft of this proposal already exists — edit it instead.' })
  })
})

const draftRow = { id: PR, project_id: P, study_id: 's1', organisation_id: 'o1', family_id: PR, version: 2, status: 'draft', case_id: 'c1', draft: goodDraft, updated_at: 'T0' }
const issueSetup = (rpc: unknown = { data: { ok: true, version: 2 }, error: null }) => {
  const user = setupUser({ tables: { 'solar.proposals': [draftRow, { id: 'old', project_id: P, family_id: PR, version: 1, status: 'issued' }] } })
  const svc = setupSvc({
    tables: { 'public.profiles': [{ id: U, full_name: 'Pat', email: 'pat@sun.example' }, { id: 'cv1', email: 'client@acme.example' }], 'projects.reports': [{ id: 'rep-old', project_id: P, kind: 'solar_proposal', source_id: 'old', status: 'issued' }], 'projects.projects': [{ id: P, name: 'Acme Mall', organisation_id: 'o1' }], 'projects.project_members': [{ project_id: P, user_id: 'cv1', role: 'client_viewer', is_active: true }] },
    writes: { 'projects.reports:insert': { data: [{ id: 'rep-new' }] } },
    rpc: { solar_issue_proposal: rpc as never },
  })
  h.prepare.mockResolvedValue({ ok: true, snapshot: proposalSnapshot(), runId: 'r1' })
  h.brandData.mockResolvedValue({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' })
  return { user, svc }
}

describe('issueSolarProposalAction', () => {
  it('freezes: stores the PDF, records its SHA-256, passes the token HASH (never the token) and the snapshot to the service function', async () => {
    const { svc } = issueSetup()
    const r = await issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: [] })
    expect(r).toEqual({ ok: true, link: `https://www.e-site.live/proposal/${'T'.repeat(43)}`, emailed: 0, emailNote: null })
    const path = `o1/${P}/solar-proposals/${PR}-v2.pdf`
    expect(svc.bucket.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false })
    const rpc = (svc.client.rpc as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === 'solar_issue_proposal')![1] as Record<string, unknown>
    expect(rpc).toMatchObject({
      p_proposal_id: PR, p_expected_updated_at: 'T0', p_case_run_id: 'r1', p_pdf_path: path,
      p_pdf_sha256: createHash('sha256').update(Buffer.from('%PDF-proposal')).digest('hex'),
      p_token_hash: 'f'.repeat(64), p_report_id: 'rep-new', p_actor: U,
      p_snapshot: proposalSnapshot(), p_expires_at: proposalSnapshot().proposal.validUntil,
    })
    expect(JSON.stringify(rpc)).not.toContain('T'.repeat(43))
    expect(callsTo(svc.calls, 'projects.reports', 'insert')[0]!.payload).toMatchObject({ kind: 'solar_proposal', source_table: 'solar.proposals', source_id: PR, version: 2, status: 'issued' })
    expect(callsTo(svc.calls, 'projects.reports', 'update')[0]!.payload).toEqual({ status: 'superseded', superseded_by: 'rep-new' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_proposal_issued', properties: { version: 2, emailed: 0 } })
  })
  it('never emails when the project toggle is off, and says so', async () => {
    issueSetup()
    h.emailOn.mockResolvedValue(false)
    const r = await issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: ['cv1'] })
    expect(r).toMatchObject({ ok: true, emailed: 0, emailNote: 'Solar emails are off for this project (Project settings, Integrations), so no email was sent.' })
    expect(h.sendClients).not.toHaveBeenCalled()
  })
  it('emails only project client viewers among the ids given, when the toggle is on', async () => {
    issueSetup()
    h.emailOn.mockResolvedValue(true)
    h.sendClients.mockResolvedValue(1)
    const r = await issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: ['cv1', 'not-a-client'] })
    expect(r).toMatchObject({ ok: true, emailed: 1 })
    expect(h.sendClients).toHaveBeenCalledWith(expect.objectContaining({ emails: ['client@acme.example'] }))
  })
  it('refuses when prepare refuses (Stale), writing nothing', async () => {
    const { svc } = issueSetup()
    h.prepare.mockResolvedValue({ ok: false, error: 'The selected case is stale — re-run it first.' })
    await expect(issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: [] })).resolves.toEqual({ error: 'The selected case is stale — re-run it first.' })
    expect(svc.bucket.upload).not.toHaveBeenCalled()
  })
  it('rolls back the stored PDF and report row when the database refuses (stale)', async () => {
    const { svc } = issueSetup({ data: { ok: false, error: 'stale' }, error: null })
    await expect(issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: [] })).resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
    expect(svc.bucket.remove).toHaveBeenCalledWith([`o1/${P}/solar-proposals/${PR}-v2.pdf`])
    expect(callsTo(svc.calls, 'projects.reports', 'delete')[0]!.filters).toContainEqual(['eq', 'id', 'rep-new'])
  })
  it('refuses a stale expectedUpdatedAt before rendering', async () => {
    issueSetup()
    await expect(issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T-old', emailClientUserIds: [] })).resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
    expect(h.render).not.toHaveBeenCalled()
  })
})

describe('withdraw / new link', () => {
  it('withdraw calls the service function with the actor and words not_live', async () => {
    setupUser({ tables: { 'solar.proposals': [{ id: PR, project_id: P, version: 2 }] } })
    const svc = setupSvc({ rpc: { solar_withdraw_proposal: { data: { ok: false, error: 'not_live' }, error: null } } })
    await expect(withdrawSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'Only an issued proposal can be withdrawn.' })
    expect(svc.client.rpc).toHaveBeenCalledWith('solar_withdraw_proposal', { p_proposal_id: PR, p_actor: U })
  })
  it('new link rotates to a fresh token hash and returns the new link once', async () => {
    setupUser({ tables: { 'solar.proposals': [{ id: PR, project_id: P, version: 2 }] } })
    const svc = setupSvc({ rpc: { solar_rotate_proposal_link: { data: { ok: true }, error: null } } })
    await expect(newSolarProposalLinkAction({ projectId: P, proposalId: PR })).resolves.toEqual({ ok: true, link: `https://www.e-site.live/proposal/${'T'.repeat(43)}` })
    expect(svc.client.rpc).toHaveBeenCalledWith('solar_rotate_proposal_link', { p_proposal_id: PR, p_token_hash: 'f'.repeat(64), p_actor: U })
  })
  it('a proposal the caller cannot see is not found (RLS read through the session)', async () => {
    setupUser(); setupSvc()
    await expect(withdrawSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'This proposal no longer exists — reload.' })
  })
})
