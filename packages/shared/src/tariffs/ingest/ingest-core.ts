/**
 * Ingestion (D-03): E-Site staff run it; it never publishes. Idempotent on the
 * file's sha256. Dry run is the default and writes nothing. Pure: the caller
 * supplies bytes, sha256 and a TariffStore.
 *
 * A published or superseded year is never changed. With `correctPublished` (and
 * only then) the file is read again even if it was ingested before, and each
 * live year it covers gets a correction draft that names it (replaces_year_id);
 * publishing that draft replaces the live year (00232, tariffs.tariff_year_guard).
 */
import { previousFinancialYear } from '../financial-year'
import { validateTariffYear, type TariffIssue } from '../validators'
import { diffTariffYears } from '../yoy'
import type {
  LicenseeKind, LossFactor, SourceDocumentKind, SourceDocumentStatus, SsegRule, Tariff, YearState,
} from '../types'
import type { Unresolved } from '../parsers/normalise'

export type ParserName = 'province_xlsx' | 'eskom_xlsm' | 'rfd_pdf'

export interface IngestSource {
  fileName: string
  bytes: Uint8Array
  sha256: string
  contentType: string
  kind: SourceDocumentKind
  title: string
  financialYear: string
  status: SourceDocumentStatus
  url: string | null
  retrievedAt: string | null
  pageCount: number | null
}

export interface LicenseeYearDraft {
  licenseeName: string
  aliases: string[]
  kind: LicenseeKind
  effectiveFrom: string
  effectiveTo: string
  approvedIncreasePct: number | null
  tariffs: Tariff[]
  lossFactors: LossFactor[]
  ssegRule: SsegRule | null
  issues: TariffIssue[]
  unresolved: Unresolved[]
}

export interface IngestPlan {
  parser: ParserName
  source: IngestSource
  years: LicenseeYearDraft[]
}

export interface StoredYear {
  id: string
  state: YearState
  /** Set on a correction draft: the published or superseded year it replaces once published. */
  replacesYearId?: string | null
}

export interface YearMeta {
  licenseeId: string
  financialYear: string
  effectiveFrom: string
  effectiveTo: string
  approvedIncreasePct: number | null
  sourceDocumentId: string
}

export interface SourceDocumentRow {
  kind: SourceDocumentKind
  title: string
  financialYear: string
  status: SourceDocumentStatus
  storagePath: string
  sha256: string
  pageCount: number | null
  url: string | null
  retrievedAt: string | null
}

export interface TariffStore {
  findSourceDocumentBySha(sha256: string): Promise<{ id: string; hasSucceededRun: boolean } | null>
  findLicenseeIdByAlias(alias: string): Promise<string | null>
  createLicensee(input: { name: string; kind: LicenseeKind; aliases: string[] }): Promise<string>
  /** The year that counts: the live (published or superseded) row if there is one, else the draft. Never a replaced row. */
  findYear(licenseeId: string, financialYear: string): Promise<StoredYear | null>
  /** The draft correcting a live year, if one is open. */
  findCorrectionDraft(yearId: string): Promise<StoredYear | null>
  loadYearTariffs(yearId: string): Promise<Tariff[]>
  uploadSource(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  insertSourceDocument(row: SourceDocumentRow): Promise<string>
  insertIngestRun(row: { sourceDocumentId: string; parser: ParserName; startedBy: string | null }): Promise<string>
  /** 'partial': some year was skipped (unknown licensee, duplicate): the file may be ingested again. */
  finishIngestRun(id: string, patch: { status: 'succeeded' | 'partial' | 'failed'; stats: unknown; diff: unknown; error: string | null }): Promise<void>
  /** `replacesYearId`: open a correction draft for that live year (the service path only). */
  insertYear(meta: YearMeta, replacesYearId?: string): Promise<string>
  updateYear(yearId: string, meta: YearMeta): Promise<void>
  setYearState(yearId: string, state: 'ingesting' | 'in_review'): Promise<void>
  /** The validators' verdict on the year's content (service role only; publish needs 0 blocking). */
  recordValidation(yearId: string, blocking: number): Promise<void>
  deleteYearChildren(yearId: string): Promise<void>
  /** Inserts tariffs and their charges; returns tariff name → id. */
  insertTariffs(yearId: string, sourceDocumentId: string, tariffs: Tariff[]): Promise<Map<string, string>>
  linkExportTariffs(links: { tariffId: string; exportTariffId: string }[]): Promise<void>
  insertLossFactors(yearId: string, factors: LossFactor[]): Promise<void>
  insertSsegRule(yearId: string, rule: SsegRule): Promise<void>
}

export type YearAction =
  | 'create' | 'replace_draft' | 'create_correction' | 'replace_correction_draft'
  | 'skip_published' | 'skip_unknown_licensee' | 'skip_duplicate_licensee'

/** Actions that leave part of the file un-ingested: the run is 'partial', not 'succeeded'. */
const INCOMPLETE: ReadonlySet<YearAction> = new Set<YearAction>(['skip_unknown_licensee', 'skip_duplicate_licensee'])

export interface YearReport {
  licensee: string
  financialYear: string
  action: YearAction
  licenseeId: string | null
  yearId: string | null
  tariffs: number
  charges: number
  blocking: number
  review: number
  unresolved: number
  yoy: { added: number; removed: number; changed: number; outOfBand: number } | null
  issues: TariffIssue[]
}

export interface IngestReport {
  status: 'dry_run' | 'applied' | 'already_ingested'
  sha256: string
  sourceDocumentId: string | null
  runId: string | null
  storagePath: string
  years: YearReport[]
}

const isLive = (y: StoredYear): boolean => y.state === 'published' || y.state === 'superseded'

/** Same rule as the licensee_alias_normalised CHECK. */
export function normaliseAlias(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase()
}

export function storagePathFor(source: Pick<IngestSource, 'financialYear' | 'sha256' | 'fileName'>): string {
  const dot = source.fileName.lastIndexOf('.')
  const ext = dot >= 0 ? source.fileName.slice(dot).toLowerCase() : ''
  return `${source.financialYear.replace('/', '-')}/${source.sha256}${ext}`
}

function summarise(reports: YearReport[]): Record<string, unknown> {
  return {
    years: reports.length,
    byAction: reports.reduce<Record<string, number>>((a, r) => ({ ...a, [r.action]: (a[r.action] ?? 0) + 1 }), {}),
    tariffs: reports.reduce((a, r) => a + r.tariffs, 0),
    charges: reports.reduce((a, r) => a + r.charges, 0),
    blocking: reports.reduce((a, r) => a + r.blocking, 0),
    review: reports.reduce((a, r) => a + r.review, 0),
    unresolved: reports.reduce((a, r) => a + r.unresolved, 0),
    issues: reports.flatMap((r) => r.issues.map((i) => ({ licensee: r.licensee, ...i }))),
  }
}

export async function runIngest(
  plan: IngestPlan, store: TariffStore,
  opts: { apply: boolean; createMissingLicensees: boolean; startedBy?: string | null; correctPublished?: boolean },
): Promise<IngestReport> {
  const { source } = plan
  const storagePath = storagePathFor(source)
  const existing = await store.findSourceDocumentBySha(source.sha256)
  if (existing?.hasSucceededRun && !opts.correctPublished) {
    return { status: 'already_ingested', sha256: source.sha256, sourceDocumentId: existing.id, runId: null, storagePath, years: [] }
  }

  const prepared: { draft: LicenseeYearDraft; report: YearReport; existingYear: StoredYear | null; correctionOf: string | null }[] = []
  // One licensee, one year per file: a second draft resolving to the same licensee (or, when
  // licensees are created, the same name) would fail the run half-way on a UNIQUE constraint.
  const claimed = new Set<string>()
  for (const draft of plan.years) {
    let licenseeId: string | null = null
    for (const alias of draft.aliases) {
      licenseeId = await store.findLicenseeIdByAlias(normaliseAlias(alias))
      if (licenseeId) break
    }
    const issues = [...draft.issues, ...validateTariffYear(draft.tariffs)]
    let yoy: YearReport['yoy'] = null
    let existingYear: StoredYear | null = null
    let correctionOf: string | null = null
    if (licenseeId) {
      const prev = await store.findYear(licenseeId, previousFinancialYear(source.financialYear))
      if (prev && (prev.state === 'published' || prev.state === 'superseded')) {
        const d = diffTariffYears(await store.loadYearTariffs(prev.id), draft.tariffs, draft.approvedIncreasePct)
        issues.push(...d.issues)
        yoy = { added: d.added.length, removed: d.removed.length, changed: d.changed.length, outOfBand: d.issues.filter((i) => i.code === 'yoy_out_of_band').length }
      }
      existingYear = await store.findYear(licenseeId, source.financialYear)
      if (existingYear && isLive(existingYear) && opts.correctPublished) {
        correctionOf = existingYear.id
        existingYear = await store.findCorrectionDraft(existingYear.id)
      }
    }
    const claimKey = licenseeId ? `id:${licenseeId}` : `name:${normaliseAlias(draft.licenseeName)}`
    const duplicate = (licenseeId !== null || opts.createMissingLicensees) && claimed.has(claimKey)
    if (duplicate) {
      issues.push({ code: 'duplicate_licensee_year', severity: 'block', message: `"${draft.licenseeName}" resolves to a licensee already planned from this file; skipped`, tariff: draft.licenseeName })
    } else if (licenseeId !== null || opts.createMissingLicensees) {
      claimed.add(claimKey)
    }
    const action: YearAction = duplicate
      ? 'skip_duplicate_licensee'
      : !licenseeId && !opts.createMissingLicensees
        ? 'skip_unknown_licensee'
        : correctionOf
          ? existingYear ? 'replace_correction_draft' : 'create_correction'
          : existingYear && isLive(existingYear)
            ? 'skip_published'
            : existingYear ? 'replace_draft' : 'create'
    prepared.push({
      draft, existingYear, correctionOf,
      report: {
        licensee: draft.licenseeName, financialYear: source.financialYear, action, licenseeId, yearId: existingYear?.id ?? null,
        tariffs: draft.tariffs.length, charges: draft.tariffs.reduce((a, t) => a + t.charges.length, 0),
        blocking: issues.filter((i) => i.severity === 'block').length,
        review: issues.filter((i) => i.severity === 'review').length,
        unresolved: draft.unresolved.length, yoy, issues,
      },
    })
  }
  const years = prepared.map((p) => p.report)
  if (!opts.apply) {
    return { status: 'dry_run', sha256: source.sha256, sourceDocumentId: existing?.id ?? null, runId: null, storagePath, years }
  }

  let sourceDocumentId = existing?.id ?? null
  if (!sourceDocumentId) {
    await store.uploadSource(storagePath, source.bytes, source.contentType)
    sourceDocumentId = await store.insertSourceDocument({
      kind: source.kind, title: source.title, financialYear: source.financialYear, status: source.status,
      storagePath, sha256: source.sha256, pageCount: source.pageCount, url: source.url, retrievedAt: source.retrievedAt,
    })
  }
  const runId = await store.insertIngestRun({ sourceDocumentId, parser: plan.parser, startedBy: opts.startedBy ?? null })
  try {
    for (const { draft, report, existingYear, correctionOf } of prepared) {
      if (report.action === 'skip_published' || INCOMPLETE.has(report.action)) continue
      const licenseeId = report.licenseeId ?? await store.createLicensee({
        name: draft.licenseeName, kind: draft.kind,
        aliases: [...new Set(draft.aliases.map(normaliseAlias).filter((a) => a !== ''))],
      })
      report.licenseeId = licenseeId
      const meta: YearMeta = {
        licenseeId, financialYear: source.financialYear, effectiveFrom: draft.effectiveFrom, effectiveTo: draft.effectiveTo,
        approvedIncreasePct: draft.approvedIncreasePct, sourceDocumentId,
      }
      let yearId: string
      if (existingYear) {
        yearId = existingYear.id
        if (existingYear.state === 'in_review') await store.setYearState(yearId, 'ingesting')
        await store.updateYear(yearId, meta)
        await store.deleteYearChildren(yearId)
      } else {
        yearId = correctionOf ? await store.insertYear(meta, correctionOf) : await store.insertYear(meta)
      }
      // A backwards block is already a blocking issue (block_range_inverted); clear its bounds so the
      // year still loads for review instead of failing tariffs.charge CHECK charge_block_order mid-file.
      const insertable = draft.tariffs.map((t) => ({ ...t, charges: t.charges.map((c) =>
        c.blockMaxKwh !== null && (c.blockMinKwh === null || c.blockMaxKwh <= c.blockMinKwh)
          ? { ...c, blockMinKwh: null, blockMaxKwh: null, blockBasis: null } : c) }))
      const ids = await store.insertTariffs(yearId, sourceDocumentId, insertable)
      const links = draft.tariffs.flatMap((t) => {
        if (!t.exportTariffCode) return []
        const target = draft.tariffs.find((x) => x.code === t.exportTariffCode)
        const a = ids.get(t.name)
        const b = target ? ids.get(target.name) : undefined
        return a && b ? [{ tariffId: a, exportTariffId: b }] : []
      })
      if (links.length > 0) await store.linkExportTariffs(links)
      if (draft.lossFactors.length > 0) await store.insertLossFactors(yearId, draft.lossFactors)
      if (draft.ssegRule) await store.insertSsegRule(yearId, draft.ssegRule)
      // After the last content write (any later change clears it again in the database).
      await store.recordValidation(yearId, report.blocking)
      await store.setYearState(yearId, 'in_review')
      report.yearId = yearId
    }
    const skipped = years.filter((r) => INCOMPLETE.has(r.action))
    await store.finishIngestRun(runId, {
      status: skipped.length > 0 ? 'partial' : 'succeeded', stats: summarise(years),
      diff: years.map((r) => ({ licensee: r.licensee, action: r.action, yoy: r.yoy })),
      error: skipped.length > 0 ? `${skipped.length} year(s) skipped: ${skipped.map((r) => `${r.licensee} (${r.action})`).join(', ')}` : null,
    })
  } catch (e) {
    await store.finishIngestRun(runId, { status: 'failed', stats: summarise(years), diff: {}, error: e instanceof Error ? e.message : String(e) })
    throw e
  }
  return { status: 'applied', sha256: source.sha256, sourceDocumentId, runId, storagePath, years }
}
