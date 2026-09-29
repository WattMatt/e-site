// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ svc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
import { createHash } from 'node:crypto'
import { keyFigures, offerPrice } from '@esite/shared/solar-reports'
import { extractPdfText, squash } from '@/test/pdf-text'
import { proposalSnapshot, proposalSnapshotInput } from '@/test/proposal-fixture'
import { fakeSupabase } from '@/test/fake-supabase'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderProposalPdf } from '@/lib/solar/reports/render-proposal'
import { loadProposalByToken } from './client'

const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' }, { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: '2026-09-29' }).branding

describe('tamper: changing the case after issue changes nothing the client sees', () => {
  let store: { snapshot: ReturnType<typeof proposalSnapshot>; pdfSha256: string }
  let pdf: Buffer
  beforeEach(async () => {
    const issued = proposalSnapshot()
    pdf = await renderProposalPdf(issued, brand, { preview: false })
    store = { snapshot: issued, pdfSha256: createHash('sha256').update(pdf).digest('hex') }
    h.svc.mockReturnValue(fakeSupabase({ rpc: { solar_proposal_by_token: () => ({ data: { state: 'viewed', version: 2, expiresAt: issued.proposal.validUntil, snapshot: store.snapshot, pdfSha256: store.pdfSha256, pdfPath: 'x', projectId: 'p' }, error: null }) } }).client)
  }, 30_000)

  it('serves the frozen snapshot, whose figures are exactly those in the issued PDF', async () => {
    // "Change the case": a bigger system at a higher price — what a recompute would now produce.
    const recomputed = proposalSnapshot({ kpis: { ...proposalSnapshotInput().kpis, dcKwp: 900, acKw: 700, annualAcKwh: 1_500_000 }, price: offerPrice(2_000_000, 15) })
    const { view } = await loadProposalByToken('A'.repeat(43), { ip: null, ua: null })
    expect(view.snapshot).toEqual(store.snapshot)
    expect(view.snapshot).not.toEqual(recomputed)
    const text = squash(extractPdfText(pdf))
    for (const f of keyFigures(view.snapshot!)) expect(text).toContain(squash(f.value))
    expect(text).not.toContain(squash(keyFigures(recomputed).find((f) => f.label === 'Offer price (excl. VAT)')!.value))
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(store.pdfSha256)
  }, 30_000)
})
