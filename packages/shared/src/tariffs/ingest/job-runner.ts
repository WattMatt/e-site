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
  error: string | null
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

export async function runIngestJob(job: IngestJob, deps: IngestJobDeps): Promise<IngestJobOutcome> {
  const src = await deps.loadSource(job.sourceDocumentId)
  if (!src) return { status: 'failed', report: null, runId: null, error: 'The source document no longer exists.' }
  let bytes: Uint8Array
  try {
    bytes = await deps.download(src.storagePath)
  } catch (e) {
    return { status: 'failed', report: null, runId: null, error: `Could not download the source: ${messageOf(e)}` }
  }
  let pdfText: string | undefined
  if (job.parser === 'rfd_pdf') {
    try {
      pdfText = await deps.pdfToText(bytes)
    } catch (e) {
      return { status: 'failed', report: null, runId: null, error: `Could not read text from the PDF: ${messageOf(e)}` }
    }
  }
  try {
    const plan = await buildIngestPlan({
      parser: job.parser, fileName: src.fileName, bytes, sha256: src.sha256, financialYear: job.financialYear,
      pdfText, licenseeName: job.licenseeName ?? undefined, url: src.url, retrievedAt: src.retrievedAt,
      netBillingRulesSha256: deps.netBillingRulesSha256 ?? null,
    })
    const report = await runIngest(plan, deps.store, { apply: true, createMissingLicensees: job.createLicensees, startedBy: job.requestedBy })
    return { status: 'succeeded', report, runId: report.runId, error: null }
  } catch (e) {
    return { status: 'failed', report: null, runId: null, error: messageOf(e) }
  }
}
