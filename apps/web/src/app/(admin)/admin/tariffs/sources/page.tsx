import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { formatSolarDate } from '@esite/shared'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { contentTypeFor } from '@/lib/tariffs/source-files'
import { SourceUpload } from './SourceUpload'
import { IngestPanel } from './IngestPanel'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>

export default async function SourcesPage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const [docs, licensees, jobs] = await Promise.all([
    t.from('source_document').select('id, kind, title, financial_year, status, storage_path, url, created_at, licensee:licensee_id(name)').order('created_at', { ascending: false }).limit(200),
    t.from('licensee').select('id, name').order('name'),
    t.from('ingest_job').select('id, source_document_id, status, requested_at, finished_at, error').order('requested_at', { ascending: false }).limit(200),
  ])
  const jobRows = (jobs.data ?? []) as Row[]
  const lastJob = new Map<string, Row>()
  for (const j of jobRows) if (!lastJob.has(String(j.source_document_id))) lastJob.set(String(j.source_document_id), j)
  const docRows = (docs.data ?? []) as Row[]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SourceUpload licensees={((licensees.data ?? []) as Array<{ id: string; name: string }>)} />
      <Card>
        <CardHeader><span className="data-panel-title">Source documents</span></CardHeader>
        <CardBody>
          {docRows.length === 0
            ? <p style={{ fontSize: 13 }}>No source documents yet. Upload a tariff book, NERSA decision or Eskom schedule above.</p>
            : <div style={{ display: 'grid', gap: 12 }}>
                {docRows.map((d) => {
                  const path = (d.storage_path as string | null) ?? ''
                  const type = path ? contentTypeFor(path) : null
                  const job = lastJob.get(String(d.id))
                  return (
                    <div key={String(d.id)} style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{String(d.title)}</strong> · {String(d.kind)} · {(d.financial_year as string | null) ?? 'no year'} · {String(d.status)}
                        {' · '}{(d.licensee as { name: string } | null)?.name ?? 'many licensees'} · added {formatSolarDate(String(d.created_at))}
                      </div>
                      {job && <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Last queued ingest: {String(job.status)}{job.error ? ` — ${String(job.error)}` : ''}</div>}
                      {type && (d.financial_year as string | null) && (
                        <IngestPanel source={{
                          id: String(d.id), fileKind: type === 'application/pdf' ? 'pdf' : 'xlsx',
                          financialYear: String(d.financial_year), licenseeName: (d.licensee as { name: string } | null)?.name ?? null,
                        }} />
                      )}
                    </div>
                  )
                })}
              </div>}
        </CardBody>
      </Card>
    </div>
  )
}
