/**
 * THE study pricing resolver (I-1, docs/solar/06-open-decisions.md). Everything that prices a
 * study — the Tariff tab bill check AND the case run / financials path — goes through this one
 * pure function, so the two cannot disagree about money:
 *
 *   tariff        the published tariff, with the project override applied (D-10 landlord resale)
 *   export        the export rule (spec §5): linked Eskom Gen-offset tariff / manual rate (with its
 *                 source note) / none. 'none' prices at ZERO even if the tariff carries its own
 *                 export_credit rows: the effective SSEG rule's crediting is 'none', so any
 *                 calculator built from this output credits nothing.
 *   sseg rule     the library row, else the Net-Billing Rules default for the licensee kind — the
 *                 rule the Tariff tab shows as in force.
 *   escalation    the Tariff tab path (D-07): approved increases of the next published years,
 *                 stored per-year overrides, the org default path.
 *   load growth   studies.load_growth_pct (Load tab, 3b), NULL -> 0.
 *
 * `studyPricingHash` (canonical; every charge list in one total order, so row order never moves it)
 * feeds the case inputs hash and the financials hash, so a change to any of the four marks the case
 * Stale. It is NOT secret on its own: the web layer keys it (HMAC, apps/web/src/lib/solar/pricing/
 * pricing-hash.ts) before it reaches the View-readable case_runs.inputs_hash.
 */
import { netBillingRule } from '../../tariffs/net-billing-rules'
import type { LicenseeKind, SsegRule, Tariff } from '../../tariffs/types'
import type { EscalationPath } from '../../services/solar/finance/factors'
import { canonicalJson, inputsHash } from '../../services/solar/hash'
import { buildEscalationRows, escalationPathFromRows, escalationSettingsFrom, parseStoredEscalation, type EscalationRow, type EscalationSettings } from './escalation'
import { defaultExportRule, manualExportTariff, parseExportRule, type ExportMethod, type ExportRateRow } from './export-rule'
import { regimeForLicenseeKind } from './financial-years'
import { overrideToTariff, type OverrideChargeRow } from './override'

export interface StudyPricingInput {
  /** The study's stored pricing choices (solar.studies). */
  study: {
    tariffOverrideId: string | null
    exportRule: unknown
    escalation: unknown
    loadGrowthPct: number | string | null
  }
  /** The pinned published tariff and what the library says about it. */
  published: {
    tariffId: string
    tariff: Tariff
    financialYear: string
    licenseeKind: LicenseeKind
    /** The tariff's linked export tariff (Eskom Gen-offset), if any. */
    exportTariff: Tariff | null
    /** The licensee's SSEG rule row for the year, if the library has one. */
    sseg: SsegRule | null
    /** The licensee's published/superseded years and their approved increases. */
    years: ReadonlyArray<{ financialYear: string; approvedIncreasePct: number | null }>
  }
  override: { id: string; rows: readonly OverrideChargeRow[] } | null
  exportRates: ReadonlyArray<ExportRateRow & { id: string; sourceNote: string | null }>
  /** readSolarOrgSettings() values (D-07 defaults fill the gaps). */
  orgSettings: Record<string, number | boolean | null | undefined>
}

export interface ResolvedStudyPricing {
  tariff: Tariff
  /** Linked or manual export tariff; null = the tariff's own export rows (only reachable for 'linked_tariff' without a link). */
  exportTariff: Tariff | null
  exportMethod: ExportMethod
  exportCredited: boolean
  /** The effective rule the calculator uses: crediting 'none' when the export rule is 'none'. */
  ssegRule: SsegRule
  /** The rule in force for the licensee (library row, else the Net-Billing Rules default) — what the Tariff tab shows. */
  ssegRuleInForce: SsegRule
  ssegFromLibrary: boolean
  escalationRows: EscalationRow[]
  escalationPath: EscalationPath
  escalationSettings: EscalationSettings
  loadGrowthPct: number
  provenance: {
    tariffId: string
    financialYear: string
    overrideId: string | null
    overrideChargeIds: string[]
    exportMethod: ExportMethod
    exportRateIds: string[]
    exportSourceNote: string | null
    loadGrowthFrom: 'study'
  }
}

/**
 * Rows arrive in whatever order the database returns them (heap order moves on every UPDATE), and
 * canonical JSON keeps array order, so every charge list is put in ONE total order before it is
 * priced or hashed: an edit and its undo must hash the same.
 */
const byCanonical = <T>(xs: readonly T[]): T[] => xs.map((x) => [canonicalJson(x), x] as const)
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, x]) => x)
const sortedTariff = (t: Tariff): Tariff => ({ ...t, charges: byCanonical(t.charges) })

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function resolveStudyPricing(i: StudyPricingInput): ResolvedStudyPricing {
  const pub = i.published
  const ov = i.override && i.study.tariffOverrideId && i.override.id === i.study.tariffOverrideId ? i.override : null
  const tariff = sortedTariff(ov ? overrideToTariff(pub.tariff, ov.rows) : pub.tariff)
  const rates = byCanonical(i.exportRates)

  const hasLinked = pub.exportTariff !== null
  const stored = parseExportRule(i.study.exportRule) ?? defaultExportRule(hasLinked)
  let method: ExportMethod = stored.method
  // A manual rule with no rates has nothing to price; a linked rule with no link falls back like the tab.
  if (method === 'manual' && rates.length === 0) method = 'none'
  const note = method === 'manual' ? (rates.find((r) => r.sourceNote)?.sourceNote ?? null) : null
  const exportTariff = method === 'manual'
    ? sortedTariff(manualExportTariff(rates.map(({ season, tou, unit, amountExclVat }) => ({ season, tou, unit, amountExclVat })), note ?? ''))
    : method === 'linked_tariff' && pub.exportTariff ? sortedTariff(pub.exportTariff) : null

  const libraryRule = pub.sseg
  const baseRule = libraryRule ?? netBillingRule(regimeForLicenseeKind(pub.licenseeKind))
  const exportCredited = method !== 'none'
  const ssegRule: SsegRule = exportCredited ? baseRule : { ...baseRule, crediting: 'none' }

  const escalationSettings = escalationSettingsFrom(i.orgSettings)
  const escalationRows = buildEscalationRows({
    pinnedFinancialYear: pub.financialYear || null,
    published: pub.years.map((y) => ({ financialYear: y.financialYear, approvedIncreasePct: y.approvedIncreasePct })),
    settings: escalationSettings,
    stored: parseStoredEscalation(i.study.escalation),
  })

  return {
    tariff,
    exportTariff: method === 'none' ? null : exportTariff,
    exportMethod: method,
    exportCredited,
    ssegRule,
    ssegRuleInForce: baseRule,
    ssegFromLibrary: libraryRule !== null,
    escalationRows,
    escalationPath: escalationPathFromRows(escalationRows, escalationSettings),
    escalationSettings,
    loadGrowthPct: num(i.study.loadGrowthPct),
    provenance: {
      tariffId: pub.tariffId,
      financialYear: pub.financialYear,
      overrideId: ov?.id ?? null,
      overrideChargeIds: ov ? ov.rows.map((r) => r.id).sort() : [],
      exportMethod: method,
      exportRateIds: method === 'manual' ? rates.map((r) => r.id).sort() : [],
      exportSourceNote: note,
      loadGrowthFrom: 'study',
    },
  }
}

/** Canonical SHA-256 of the whole resolved pricing (engine spec §1.3 canonical JSON). */
export function studyPricingHash(p: ResolvedStudyPricing): string {
  return inputsHash(p)
}
