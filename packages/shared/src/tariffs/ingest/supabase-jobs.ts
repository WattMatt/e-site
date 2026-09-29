/**
 * Service-role access to tariffs.ingest_job for the staff worker. NEVER import
 * into a client bundle (built from a service key).
 */
import { createClient } from '@supabase/supabase-js'
import { summariseIngestReport, type IngestJob, type IngestJobOutcome, type IngestJobSource } from './job-runner'
import type { ParserName } from './ingest-core'

type Row = Record<string, unknown>

export function jobFromRow(r: Row): IngestJob {
  return {
    id: String(r.id), sourceDocumentId: String(r.source_document_id), parser: r.parser as ParserName,
    financialYear: String(r.financial_year), licenseeName: (r.licensee_name ?? null) as string | null,
    createLicensees: Boolean(r.create_licensees), requestedBy: (r.requested_by ?? null) as string | null,
  }
}

export function jobFinishPatch(o: IngestJobOutcome, nowIso: string): Row {
  return {
    status: o.status, finished_at: nowIso, ingest_run_id: o.runId,
    report: o.report ? summariseIngestReport(o.report) : null, error: o.error,
  }
}

export function createSupabaseJobQueue(url: string, serviceKey: string) {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const t = () => db.schema('tariffs')
  return {
    async claim(): Promise<IngestJob | null> {
      const { data, error } = await t().rpc('claim_ingest_job')
      if (error) throw new Error(`claim_ingest_job: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as Row | undefined | null
      return row ? jobFromRow(row) : null
    },
    async finish(id: string, outcome: IngestJobOutcome): Promise<void> {
      const { error } = await t().from('ingest_job').update(jobFinishPatch(outcome, new Date().toISOString())).eq('id', id)
      if (error) throw new Error(`finish ${id}: ${error.message}`)
    },
    async loadSource(id: string): Promise<IngestJobSource | null> {
      const { data } = await t().from('source_document').select('storage_path, sha256, url, retrieved_at').eq('id', id).maybeSingle()
      const d = data as Row | null
      if (!d?.storage_path || !d.sha256) return null
      const path = String(d.storage_path)
      return { storagePath: path, fileName: path.split('/').pop() ?? path, sha256: String(d.sha256), url: (d.url ?? null) as string | null, retrievedAt: (d.retrieved_at ?? null) as string | null }
    },
    async download(path: string): Promise<Uint8Array> {
      const { data, error } = await db.storage.from('tariff-sources').download(path)
      if (error || !data) throw new Error(error?.message ?? 'empty download')
      return new Uint8Array(await data.arrayBuffer())
    },
    async rulesSha256(): Promise<string | null> {
      const { data } = await t().from('source_document').select('sha256').eq('kind', 'rules').order('created_at', { ascending: false }).limit(1)
      const first = ((data ?? []) as Row[])[0]
      return (first?.sha256 as string | undefined) ?? null
    },
  }
}
