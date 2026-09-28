/** Loaded year rows + checks -> the JSON the client review queue renders. */
import type { ChargeComponent, SourceLocator, TariffIssue, TariffUnit } from '@esite/shared'
import type { LoadedTariff } from '@/lib/tariffs/load-year'

export interface ReviewIssue { severity: 'block' | 'review' | 'warn'; message: string }

export interface ReviewCharge {
  id: string
  component: ChargeComponent
  season: string
  tou: string
  dayType: string
  blockMin: number | null
  blockMax: number | null
  unit: TariffUnit
  amount: number
  vatBasis: string
  unitInferred: boolean
  inferenceReason: string | null
  reviewedAt: string | null
  needsReview: boolean
  sourceDocumentId: string | null
  locator: SourceLocator
  issues: ReviewIssue[]
}

export interface ReviewTariff {
  id: string
  name: string
  code: string | null
  structure: string
  issues: ReviewIssue[]
  charges: ReviewCharge[]
}

export function buildReviewModel(loaded: LoadedTariff[], issues: TariffIssue[]): ReviewTariff[] {
  return loaded.map((l) => {
    const mine = issues.filter((i) => i.tariff === l.tariff.name)
    return {
      id: l.id, name: l.tariff.name, code: (l.row.code as string | null) ?? null, structure: l.tariff.structure,
      issues: mine.filter((i) => i.chargeIndex === undefined).map((i) => ({ severity: i.severity, message: i.message })),
      charges: l.tariff.charges.map((c, k) => {
        const row = l.chargeRows[k] ?? {}
        const reviewedAt = (row.reviewed_at ?? null) as string | null
        return {
          id: String(row.id), component: c.component, season: c.season, tou: c.tou, dayType: c.dayType,
          blockMin: c.blockMinKwh, blockMax: c.blockMaxKwh, unit: c.unit, amount: c.amountExclVat, vatBasis: c.vatBasis,
          unitInferred: c.unitInferred, inferenceReason: c.inferenceReason, reviewedAt,
          needsReview: c.unitInferred && reviewedAt === null,
          sourceDocumentId: (row.source_document_id ?? null) as string | null,
          locator: (row.source_locator ?? {}) as SourceLocator,
          issues: mine.filter((i) => i.chargeIndex === k).map((i) => ({ severity: i.severity, message: i.message })),
        }
      }),
    }
  })
}
