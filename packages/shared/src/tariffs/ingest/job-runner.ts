/**
 * One queued tariffs.ingest_job, executed (D-03: staff run ingestion; it never
 * publishes). Pure: the caller supplies storage, PDF text extraction and the
 * TariffStore. Same buildIngestPlan + runIngest as scripts/tariffs/ingest.ts.
 *
 * Why a job at all: 2a's RfD parser reads poppler's `pdftotext -layout`
 * output, which is not available on Vercel, so a PDF ingest is queued and run
 * by scripts/tariffs/ingest-worker.ts on the staff machine.
 */
import { buildIngestPlan } from './build-plan'
import { runIngest, type IngestReport, type ParserName, type TariffStore } from './ingest-core'

export interface IngestJob {
  id: string
  sourceDocumentId: string
  parser: ParserName
  financialYear: string
  licenseeName: string | null
  createLicensees: boolean
  requestedBy: string | null
}

export interface IngestJobSource {
  storagePath: string
  fileName: string
  sha256: string
  url: string | null
  retrievedAt: string | null
}

export interface IngestJobDeps {
  loadSource(sourceDocumentId: string): Promise<IngestJobSource | null>
  download(storagePath: string): Promise<Uint8Array>
  pdfToText(bytes: Uint8Array): Promise<string>
  store: TariffStore
  /** sha256 of the stored Net-Billing Rules PDF (eskom_xlsm only; owner default 9). */
  netBillingRulesSha256?: string | null
}

export interface IngestJobOutcome {
  status: 'succeeded' | 'failed'
  report: IngestReport | null
  runId: string | null
  /** A fixed sentence for ingest_job.error (the admin page shows it). Never exception text. */
  error: string | null
  /** The raw exception, for the worker's console only; never stored. */
  detail: string | null
}

/** What the admin UI shows and ingest_job.report stores: per-year counts and the first 25 issues. */
export interface IngestReportSummary {
  status: IngestReport['status']
  runId: string | null
  years: Array<{
    licensee: string
    action: IngestReport['years'][number]['action']
    tariffs: number
    charges: number
    blocking: number
    review: number
    unresolved: number
    yoy: IngestReport['years'][number]['yoy']
    issues: Array<{ code: string; severity: string; message: string; tariff: string | null }>
  }>
}

export function summariseIngestReport(r: IngestReport): IngestReportSummary {
  return {
    status: r.status,
    runId: r.runId,
    years: r.years.map((y) => ({
      licensee: y.licensee, action: y.action, tariffs: y.tariffs, charges: y.charges, blocking: y.blocking,
      review: y.review, unresolved: y.unresolved, yoy: y.yoy,
      issues: y.issues.slice(0, 25).map((i) => ({ code: i.code, severity: i.severity, message: i.message, tariff: i.tariff ?? null })),
    })),
  }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const SOURCE_CHECKSUM_MISMATCH = "The file's checksum no longer matches the registered document. Upload it again as a new document."
export const INGEST_JOB_ERRORS = {
  sourceGone: 'The source document no longer exists.',
  download: 'The stored file could not be downloaded.',
  pdf: 'The PDF could not be read.',
  checksum: SOURCE_CHECKSUM_MISMATCH,
  ingest: 'The ingest failed — run it again or check the worker log.',
} as const

/** Hex sha256 via Web Crypto (Node 18+ and browsers; no node:crypto import in a shared module). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function runIngestJob(job: IngestJob, deps: IngestJobDeps): Promise<IngestJobOutcome> {
  const src = await deps.loadSource(job.sourceDocumentId)
  if (!src) return { status: 'failed', report: null, runId: null, error: INGEST_JOB_ERRORS.sourceGone, detail: null }
  let bytes: Uint8Array
  try {
    bytes = await deps.download(src.storagePath)
  } catch (e) {
    return { status: 'failed', report: null, runId: null, error: INGEST_JOB_ERRORS.download, detail: messageOf(e) }
  }
  // The registered sha256 is the provenance every ingested charge cites: never parse other bytes under it.
  if ((await sha256Hex(bytes)) !== src.sha256.toLowerCase()) {
    return { status: 'failed', report: null, runId: null, error: INGEST_JOB_ERRORS.checksum, detail: null }
  }
  let pdfText: string | undefined
  if (job.parser === 'rfd_pdf') {
    try {
      pdfText = await deps.pdfToText(bytes)
    } catch (e) {
      return { status: 'failed', report: null, runId: null, error: INGEST_JOB_ERRORS.pdf, detail: messageOf(e) }
    }
  }
  try {
    const plan = await buildIngestPlan({
      parser: job.parser, fileName: src.fileName, bytes, sha256: src.sha256, financialYear: job.financialYear,
      pdfText, licenseeName: job.licenseeName ?? undefined, url: src.url, retrievedAt: src.retrievedAt,
      netBillingRulesSha256: deps.netBillingRulesSha256 ?? null,
    })
    const report = await runIngest(plan, deps.store, { apply: true, createMissingLicensees: job.createLicensees, startedBy: job.requestedBy })
    return { status: 'succeeded', report, runId: report.runId, error: null, detail: null }
  } catch (e) {
    return { status: 'failed', report: null, runId: null, error: INGEST_JOB_ERRORS.ingest, detail: messageOf(e) }
  }
}
