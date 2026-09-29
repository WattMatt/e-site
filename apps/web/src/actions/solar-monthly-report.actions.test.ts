import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit_financials'),
  gen: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), rateLimit: vi.fn(() => true),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/operations/monthly-report', () => ({ generateMonthlyReport: h.gen }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { generateSolarMonthlyReportAction, saveMonthlyReportNoteAction } from './solar-monthly-report.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ userId: 'u1' }).client)
  h.gen.mockResolvedValue({ ok: true, reportId: 'rep1', version: 2, warning: null })
})

describe('generateSolarMonthlyReportAction', () => {
  it('gates Edit + financials FIRST; validates before any work; records audit and event', async () => {
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-3', note: '' })).resolves.toEqual({ error: 'Choose a month.' })
    expect(h.gen).not.toHaveBeenCalled()
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '  Rev B ' })).resolves.toEqual({ ok: true, reportId: 'rep1', version: 2, warning: null })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, month: '2026-03', note: 'Rev B', userId: 'u1' }))
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'monthly_report_generated', objectRef: { period: '2026-03', version: 2, reportId: 'rep1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_monthly_report_generated', properties: { period: '2026-03' } })
  })
  it('refuses an overlong note; rate-limits; passes refusals through without side effects', async () => {
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: 'x'.repeat(2001) })).resolves.toEqual({ error: 'The revision note is at most 2000 characters.' })
    h.rateLimit.mockReturnValueOnce(false)
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '' })).resolves.toEqual({ error: 'Too many reports at once — wait a minute and try again.' })
    h.gen.mockResolvedValue({ ok: false, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '' })).resolves.toEqual({ error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
})

describe('saveMonthlyReportNoteAction', () => {
  it('inserts the first note, then updates on the loaded version; never touches a stored report', async () => {
    const f = fakeSupabase({ userId: 'u1', writes: { 'solar.monthly_report_notes:insert': { data: [{ updated_at: 'N1' }] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveMonthlyReportNoteAction({ projectId: P, installationId: 'i1', month: '2026-03', section: 'summary', body: ' Good ', expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'N1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
    expect(callsTo(f.calls, 'solar.monthly_report_notes', 'insert')[0]!.payload).toEqual({ installation_id: 'i1', period_month: '2026-03-01', section: 'summary', body: 'Good' })
    expect(callsTo(f.calls, 'solar.monthly_reports', 'update')).toHaveLength(0)
    await expect(saveMonthlyReportNoteAction({ projectId: P, installationId: 'i1', month: '2026-03', section: 'nope' as never, body: '', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Unknown commentary section.' })
  })
  it('an update is scoped to the gated project (review A2)', async () => {
    const f = fakeSupabase({ userId: 'u1', writes: { 'solar.monthly_report_notes:update': { data: [{ updated_at: 'N2' }] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveMonthlyReportNoteAction({ projectId: P, installationId: 'i1', month: '2026-03', section: 'summary', body: 'Better', expectedUpdatedAt: 'N1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'N2' })
    expect(callsTo(f.calls, 'solar.monthly_report_notes', 'update')[0]!.filters).toEqual([
      ['eq', 'installation_id', 'i1'], ['eq', 'project_id', P], ['eq', 'period_month', '2026-03-01'], ['eq', 'section', 'summary'], ['eq', 'updated_at', 'N1']])
  })
})

describe('generateSolarMonthlyReportAction when a read fails (review A5)', () => {
  it('returns a sentence, never the database text, and records nothing', async () => {
    h.gen.mockRejectedValue(new Error('meter totals could not be read: permission denied for table meter_readings_p3'))
    const r = await generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '' })
    expect(r).toEqual({ error: 'The month’s generation data could not be read — try again.' })
    expect(JSON.stringify(r)).not.toMatch(/permission denied|meter_readings/)
    expect(h.audit).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })
})
