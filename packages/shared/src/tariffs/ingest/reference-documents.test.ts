import { describe, expect, it } from 'vitest'
import { netBillingRule } from '../net-billing-rules'
import { ESKOM_APPROVED_INCREASE_PCT, ESKOM_INCREASE_2026_27_URL, referenceDocuments } from './reference-documents'

describe('owner defaults 8 and 9: reference documents', () => {
  it('records the Eskom approved increases: 2026/27 direct 8.76 %, local authority 9.01 %; 2025/26 left null', () => {
    expect(ESKOM_APPROVED_INCREASE_PCT['2026/27']).toEqual({ direct: 8.76, localAuthority: 9.01, sourceUrl: ESKOM_INCREASE_2026_27_URL })
    expect(ESKOM_APPROVED_INCREASE_PCT['2025/26']).toEqual({ direct: null, localAuthority: null, sourceUrl: null })
  })

  it('lists the Net-Billing Rules PDF (stored by sha256) and the URL-only Eskom 2026/27 decision', () => {
    const sha = 'd'.repeat(64)
    const docs = referenceDocuments({ netBillingRules: { sha256: sha, fileName: 'Net-Billing-Rules-licensed-Distributors.pdf', pageCount: 14 } })
    expect(docs).toEqual([
      expect.objectContaining({ kind: 'rules', sha256: sha, storagePath: `reference/${sha}.pdf`, status: 'final', financialYear: null, licenseeAlias: null }),
      expect.objectContaining({ kind: 'nersa_decision', sha256: null, storagePath: null, url: ESKOM_INCREASE_2026_27_URL, financialYear: '2026/27', licenseeAlias: 'ESKOM' }),
    ])
    // Without the PDF only the URL-only decision is planned.
    expect(referenceDocuments({}).map((d) => d.kind)).toEqual(['nersa_decision'])
  })

  it('lets a net-billing rule cite the Rules document by sha256', () => {
    expect(netBillingRule('eskom', { rulesSha256: 'e'.repeat(64) }).sourceDocumentSha256).toBe('e'.repeat(64))
    expect(netBillingRule('eskom').sourceDocumentSha256).toBeNull()
  })
})
