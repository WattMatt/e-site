/**
 * POST /api/admin/tariffs/ingest — run 2a's ingestion core on a stored
 * workbook (province compendium XLSX, Eskom schedule XLSM). Platform tariff
 * admins only (404 otherwise; this route is outside (admin)/layout.tsx).
 * Dry run (apply=false) writes nothing; apply lands years in_review, never
 * published (D-03). PDFs need poppler and run as tariffs.ingest_job instead.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildIngestPlan, createSupabaseTariffStore, runIngest, summariseIngestReport, type ParserName } from '@esite/shared/tariffs/ingest'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdminAPI } from '@/lib/tariffs/admin-gate'

export const runtime = 'nodejs'
export const maxDuration = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

interface Body {
  sourceDocumentId: string
  parser: ParserName
  financialYear: string
  licenseeName: string
  createLicensees: boolean
  apply: boolean
}

function parseBody(b: unknown): Body | null {
  if (!b || typeof b !== 'object') return null
  const o = b as Record<string, unknown>
  if (typeof o.sourceDocumentId !== 'string' || !o.sourceDocumentId) return null
  if (typeof o.parser !== 'string' || !['province_xlsx', 'eskom_xlsm', 'rfd_pdf'].includes(o.parser)) return null
  if (typeof o.financialYear !== 'string' || !/^\d{4}\/\d{2}$/.test(o.financialYear)) return null
  return {
    sourceDocumentId: o.sourceDocumentId, parser: o.parser as ParserName, financialYear: o.financialYear,
    licenseeName: typeof o.licenseeName === 'string' ? o.licenseeName.trim() : '',
    createLicensees: o.createLicensees === true, apply: o.apply === true,
  }
}

export async function POST(req: Request) {
  const gate = await requirePlatformTariffAdminAPI()
  if (!gate.ok) return gate.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Send a JSON body.' }, { status: 400 })
  }
  const b = parseBody(raw)
  if (!b) return NextResponse.json({ error: 'Choose a source, a parser and a financial year like 2026/27.' }, { status: 400 })
  if (b.parser === 'rfd_pdf') return NextResponse.json({ error: 'PDF ingests run as a job: use Queue ingest.' }, { status: 400 })

  const t = gate.supabase.schema('tariffs')
  const { data: d } = await t.from('source_document').select('id, storage_path, sha256, url, retrieved_at').eq('id', b.sourceDocumentId).maybeSingle()
  const doc = d as { storage_path: string | null; sha256: string | null; url: string | null; retrieved_at: string | null } | null
  if (!doc?.storage_path || !doc.sha256) return NextResponse.json({ error: 'That source has no stored file.' }, { status: 404 })

  let rulesSha: string | null = null
  if (b.parser === 'eskom_xlsm') {
    const { data: rules } = await t.from('source_document').select('sha256').eq('kind', 'rules').order('created_at', { ascending: false }).limit(1)
    rulesSha = ((rules ?? []) as Array<{ sha256: string | null }>)[0]?.sha256 ?? null
    if (b.apply && !rulesSha) {
      return NextResponse.json({ error: 'Upload the NERSA Net-Billing Rules PDF (kind: Rules) first: the Eskom export rule must cite it.' }, { status: 409 })
    }
  }

  const svc = createServiceClient() as unknown as AnyClient
  const dl = await svc.storage.from('tariff-sources').download(doc.storage_path)
  if (dl.error || !dl.data) return NextResponse.json({ error: 'Could not read the stored file. Try again.' }, { status: 502 })
  const bytes = new Uint8Array(await (dl.data as Blob).arrayBuffer())

  try {
    const plan = await buildIngestPlan({
      parser: b.parser, fileName: doc.storage_path.split('/').pop() ?? doc.storage_path, bytes, sha256: doc.sha256,
      financialYear: b.financialYear, licenseeName: b.licenseeName || undefined, url: doc.url, retrievedAt: doc.retrieved_at,
      netBillingRulesSha256: rulesSha,
    })
    const store = createSupabaseTariffStore(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const report = await runIngest(plan, store, { apply: b.apply, createMissingLicensees: b.createLicensees, startedBy: gate.userId })
    return NextResponse.json({ report: summariseIngestReport(report) })
  } catch (e) {
    console.error('[tariff-ingest] failed', { sourceDocumentId: b.sourceDocumentId, parser: b.parser, err: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'The file could not be ingested. Check the parser and the financial year, then try again.' }, { status: 500 })
  }
}
