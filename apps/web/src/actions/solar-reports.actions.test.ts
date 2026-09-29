import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(), gen: vi.fn(),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), rateLimit: vi.fn(() => true),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/reports/generate', () => ({ generateSolarReport: h.gen }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { generateSolarReportAction } from './solar-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ userId: 'u1' }).client)
  h.requireSolarLevel.mockResolvedValue('edit_financials')
  h.gen.mockResolvedValue({ ok: true, reportId: 'rep1', version: 2, warning: null })
})

describe('generateSolarReportAction', () => {
  it('feasibility gates Edit + financials; technical gates Edit — FIRST', async () => {
    await generateSolarReportAction({ projectId: P, kind: 'feasibility', note: '', options: { includeLayoutSheet: false, include8760: false } })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
    await generateSolarReportAction({ projectId: P, kind: 'technical', note: '', options: { includeLayoutSheet: false, include8760: false } })
    expect(h.requireSolarLevel).toHaveBeenLastCalledWith(P, 'edit', expect.anything())
  })
  it('refuses a bad kind or an overlong note before any work', async () => {
    await expect(generateSolarReportAction({ projectId: P, kind: 'monthly' as never, note: '', options: { includeLayoutSheet: false, include8760: false } })).resolves.toEqual({ error: 'Unknown report type.' })
    await expect(generateSolarReportAction({ projectId: P, kind: 'technical', note: 'x'.repeat(2001), options: { includeLayoutSheet: false, include8760: false } })).resolves.toEqual({ error: 'The revision note is too long (2000 characters at most).' })
    expect(h.gen).not.toHaveBeenCalled()
  })
  it('records audit + product event on success, with a trimmed note', async () => {
    await expect(generateSolarReportAction({ projectId: P, kind: 'feasibility', note: '  Rev B ', options: { includeLayoutSheet: false, include8760: true } }))
      .resolves.toEqual({ ok: true, reportId: 'rep1', version: 2, warning: null })
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, kind: 'feasibility', note: 'Rev B', userId: 'u1', options: { includeLayoutSheet: false, include8760: true } }))
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'report_generated', objectRef: { kind: 'feasibility', version: 2, reportId: 'rep1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_report_generated', properties: { kind: 'feasibility' } })
  })
  it('passes the refusal through without side effects', async () => {
    h.gen.mockResolvedValue({ ok: false, error: 'The selected case is stale — re-run it first.' })
    await expect(generateSolarReportAction({ projectId: P, kind: 'technical', note: '', options: { includeLayoutSheet: false, include8760: false } }))
      .resolves.toEqual({ error: 'The selected case is stale — re-run it first.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('rate-limits per user', async () => {
    h.rateLimit.mockReturnValueOnce(false)
    await expect(generateSolarReportAction({ projectId: P, kind: 'technical', note: '', options: { includeLayoutSheet: false, include8760: false } }))
      .resolves.toEqual({ error: 'Too many reports at once — wait a minute and try again.' })
  })
})
