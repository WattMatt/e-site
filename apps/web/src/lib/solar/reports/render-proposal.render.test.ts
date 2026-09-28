// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { financeOptionTable, keyFigures } from '@esite/shared/solar-reports'
import { isWinAnsi } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { proposalSnapshot } from '@/test/proposal-fixture'
import { solarBranding } from './branding'
import { renderProposalPdf } from './render-proposal'

const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' },
  { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: '2026-09-29' }).branding

describe('renderProposalPdf (real render, decoded content streams)', () => {
  it('prints EVERY key figure and finance-table cell exactly as the snapshot formats them', async () => {
    const snap = proposalSnapshot()
    const text = squash(extractPdfText(await renderProposalPdf(snap, brand, { preview: false })))
    for (const f of keyFigures(snap)) {
      expect(text).toContain(squash(f.label))
      expect(text).toContain(squash(f.value))
    }
    const t = financeOptionTable(snap)
    for (const c of [...t.columns, ...t.rows.flat()].filter(Boolean)) expect(text).toContain(squash(c))
  }, 30_000)

  it('no glyph outside WinAnsi; hostile text spelled out; margin and capex never printed', async () => {
    const raw = extractPdfText(await renderProposalPdf(proposalSnapshot(), brand, { preview: false }))
    expect([...raw].filter((c) => c !== '\n' && !isWinAnsi(c))).toEqual([])
    expect(squash(raw)).toContain(squash('Insulation <= 0,2 Ohm Yes'))
    expect(squash(raw)).toContain(squash('Rooftop PV for Acme -> phase 1'))
    expect(raw).not.toMatch(/margin/i)
    expect(squash(raw)).not.toContain('R1000000')
  }, 30_000)

  it('PREVIEW watermark only on a preview', async () => {
    const snap = proposalSnapshot()
    expect(extractPdfText(await renderProposalPdf(snap, brand, { preview: true }))).toContain('PREVIEW')
    expect(extractPdfText(await renderProposalPdf(snap, brand, { preview: false }))).not.toContain('PREVIEW')
  }, 30_000)
})
