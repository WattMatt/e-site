import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ createClient: vi.fn(), ctx: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.ctx }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
import { saveSolarProposalTemplatesAction } from './solar-proposal-templates.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

beforeEach(() => {
  vi.clearAllMocks()
  h.ctx.mockResolvedValue({ userId: 'u1', organisationId: 'o1', role: 'admin' })
  h.requireRole.mockResolvedValue({ ok: true })
})

describe('saveSolarProposalTemplatesAction', () => {
  it('owner/admin only (the result object, .ok)', async () => {
    h.createClient.mockResolvedValue(fakeSupabase().client)
    h.requireRole.mockResolvedValue({ ok: false, error: 'nope' })
    await expect(saveSolarProposalTemplatesAction({ termsText: '', disclaimerText: '', validityDays: 30, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change proposal templates.' })
  })
  it('validates, then inserts the first time', async () => {
    const f = fakeSupabase({ writes: { 'solar.proposal_templates:insert': { data: [{ updated_at: 'T1' }] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveSolarProposalTemplatesAction({ termsText: 'T', disclaimerText: 'D', validityDays: 400, expectedUpdatedAt: null }))
      .resolves.toEqual({ fieldErrors: { validityDays: 'Between 1 and 365 days' } })
    await expect(saveSolarProposalTemplatesAction({ termsText: 'T', disclaimerText: 'D', validityDays: 45, expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(f.calls, 'solar.proposal_templates', 'insert')[0]!.payload).toEqual({ organisation_id: 'o1', terms_text: 'T', disclaimer_text: 'D', validity_days: 45 })
  })
  it('updates stale-guarded afterwards', async () => {
    const f = fakeSupabase({ writes: { 'solar.proposal_templates:update': { data: [] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveSolarProposalTemplatesAction({ termsText: 'T', disclaimerText: 'D', validityDays: 30, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
})
