/**
 * Reference documents the library cites that are not tariff books (owner
 * defaults 8 and 9, 2026-09-28). Seeded with the licensee registry, before
 * any ingestion, by scripts/tariffs/seed-licensee-registry.ts.
 */
import type { SourceDocumentKind, SourceDocumentStatus } from '../types'

export const ESKOM_INCREASE_2026_27_URL = 'https://www.eskom.co.za/distribution/2026-2027-tariff-increase/'

/**
 * NERSA-approved average Eskom increases, per Eskom financial year. 2025/26 is
 * left null by the owner (default 8); the local-authority figure applies to the
 * "Eskom (Local Authority tariffs)" licensee, whose sheets 2a does not parse.
 */
export const ESKOM_APPROVED_INCREASE_PCT: Record<string, { direct: number | null; localAuthority: number | null; sourceUrl: string | null }> = {
  '2025/26': { direct: null, localAuthority: null, sourceUrl: null },
  '2026/27': { direct: 8.76, localAuthority: 9.01, sourceUrl: ESKOM_INCREASE_2026_27_URL },
}

export interface ReferenceDocument {
  kind: SourceDocumentKind
  title: string
  financialYear: string | null
  status: SourceDocumentStatus
  /** Null for a URL-only reference. */
  sha256: string | null
  storagePath: string | null
  url: string | null
  pageCount: number | null
  /** Resolved to source_document.licensee_id through licensee_alias; null for a document covering many licensees. */
  licenseeAlias: string | null
  fileName: string | null
}

export function referenceDocuments(input: {
  netBillingRules?: { sha256: string; fileName: string; pageCount?: number | null } | null
}): ReferenceDocument[] {
  const docs: ReferenceDocument[] = []
  const rules = input.netBillingRules
  if (rules) {
    docs.push({
      kind: 'rules', title: 'NERSA Net-Billing Rules for licensed distributors (approved 17 December 2024)',
      financialYear: null, status: 'final', sha256: rules.sha256, storagePath: `reference/${rules.sha256}.pdf`,
      url: null, pageCount: rules.pageCount ?? null, licenseeAlias: null, fileName: rules.fileName,
    })
  }
  docs.push({
    kind: 'nersa_decision', title: 'Eskom 2026/27 tariff increase: 8.76 % direct, 9.01 % local authority (NERSA-approved)',
    financialYear: '2026/27', status: 'nersa_approved', sha256: null, storagePath: null,
    url: ESKOM_INCREASE_2026_27_URL, pageCount: null, licenseeAlias: 'ESKOM', fileName: null,
  })
  return docs
}
