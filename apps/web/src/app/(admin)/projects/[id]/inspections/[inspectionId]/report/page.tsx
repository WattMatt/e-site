import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import RegenerateButton from './RegenerateButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Certificate' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

interface Props {
  params: Promise<{ id: string; inspectionId: string }>
}

export default async function ReportPage({ params }: Props) {
  const { id: projectId, inspectionId } = await params
  const supabase = (await createClient()) as AnyClient

  // The inspection row is the source of truth for cert status + COC number.
  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('coc_number, status')
    .eq('id', inspectionId)
    .maybeSingle()
  if (!insp) notFound()

  // The PDF artifact is the latest issued projects.reports row (kind=inspection).
  const { data: report } = await supabase
    .schema('projects')
    .from('reports')
    .select('id, storage_path, version, generated_at')
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const isCertified = insp.status === 'certified'
  if (!report && !isCertified) notFound()

  let signedUrl: string | null = null
  if (report) {
    const { data: signed } = await supabase.storage.from('reports').createSignedUrl(report.storage_path, 3600)
    signedUrl = signed?.signedUrl ?? null
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections/${inspectionId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Inspection
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Certificate {insp.coc_number ?? ''}</h1>
          <p className="page-subtitle">
            {report
              ? `Generated ${new Date(report.generated_at).toLocaleString('en-ZA')} · v${report.version}`
              : 'Certificate PDF not generated yet'}
          </p>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={isCertified ? 'success' : 'warning'}>{isCertified ? 'certified' : insp.status}</Badge>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {signedUrl && (
            <a href={signedUrl} download={`${insp.coc_number ?? 'certificate'}.pdf`} style={{ textDecoration: 'none' }}>
              <Button variant="primary">↓ Download</Button>
            </a>
          )}
          {isCertified && (
            <RegenerateButton inspectionId={inspectionId} projectId={projectId} hasReport={!!report} />
          )}
        </div>
      </div>

      {signedUrl ? (
        <iframe
          src={signedUrl}
          title={`Certificate ${insp.coc_number ?? ''}`}
          style={{ width: '100%', height: '80vh', border: '1px solid var(--c-border)', borderRadius: 8, background: 'var(--c-panel)' }}
        />
      ) : (
        <div style={{ padding: 16, background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-dim)', fontSize: 13 }}>
          {isCertified
            ? 'The certificate PDF has not been generated yet. Click "Generate certificate" to produce it.'
            : 'Could not load the certificate PDF.'}
        </div>
      )}
    </div>
  )
}
