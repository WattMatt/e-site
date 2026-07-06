import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import RegenerateButton from './RegenerateButton'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { requireRole } from '@/lib/auth/require-role'
import { listProjectReportsAction } from '@/actions/project-reports.actions'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'

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

  // Inspection row = source of truth for COC + certified status.
  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('coc_number, status, certified_at')
    .eq('id', inspectionId)
    .maybeSingle()
  if (!insp) notFound()

  // Branded PDF artifact = latest issued projects.reports row for this inspection.
  const { data: report } = await supabase
    .schema('projects')
    .from('reports')
    .select('id, storage_path, version, created_at')
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const signed = report
    ? (await supabase.storage.from('reports').createSignedUrl(report.storage_path, 3600)).data
    : null

  const isCertified = insp.status === 'certified'
  const coc = (insp.coc_number as string | null) ?? null

  // Standards-validation audit (SANS rule engine, run at certify). SELECT is
  // RLS-scoped via user_has_inspection_read, so the user client is correct.
  const { data: validationRows } = await supabase
    .schema('inspections')
    .from('coc_validations')
    .select('id, rule_code, sans_clause, rule_label, result, measured_value, threshold, failure_reason, validated_at')
    .eq('inspection_id', inspectionId)
    .order('rule_code')
  const validations = (validationRows ?? []) as Array<{
    id: string
    rule_code: string
    sans_clause: string | null
    rule_label: string
    result: 'pass' | 'fail' | 'not_applicable' | 'insufficient_data'
    measured_value: string | null
    threshold: string | null
    failure_reason: string | null
    validated_at: string
  }>
  const VALIDATION_BADGE: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
    pass: 'success',
    fail: 'danger',
    insufficient_data: 'warning',
    not_applicable: 'default',
  }

  // Saved certificate history for this inspection (entity-scoped panel).
  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  const orgId = (project?.organisation_id as string | undefined) ?? undefined
  const canManageReports = orgId ? (await requireRole(supabase, orgId, ORG_WRITE_ROLES)).ok : false
  const reportsRes = await listProjectReportsAction(projectId, 'inspection', { table: 'inspections', id: inspectionId })
  const savedReports = Array.isArray(reportsRes) ? reportsRes : []

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections/${inspectionId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Inspection
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Certificate {coc ?? '—'}</h1>
          <p className="page-subtitle">
            {report
              ? `Generated ${new Date(report.created_at).toLocaleString('en-ZA')} · v${report.version}`
              : 'No certificate generated yet'}
          </p>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={isCertified ? 'success' : 'info'}>{insp.status}</Badge>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {signed?.signedUrl && (
            <a href={signed.signedUrl} download={`${coc ?? inspectionId}.pdf`} style={{ textDecoration: 'none' }}>
              <Button variant="primary">↓ Download</Button>
            </a>
          )}
          {isCertified && (
            <RegenerateButton inspectionId={inspectionId} projectId={projectId} hasReport={!!report} />
          )}
        </div>
      </div>

      {signed?.signedUrl ? (
        <iframe
          src={signed.signedUrl}
          title={`Certificate ${coc ?? ''}`}
          style={{
            width: '100%',
            height: '80vh',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            background: 'var(--c-panel)',
          }}
        />
      ) : (
        <div
          style={{
            padding: 16,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            color: 'var(--c-text-dim)',
            fontSize: 13,
          }}
        >
          {isCertified
            ? 'No certificate PDF on file yet — use “Generate certificate” to produce it.'
            : 'This inspection is not certified yet. The certificate appears here once it is certified.'}
        </div>
      )}

      {validations.length > 0 && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h2 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--c-text)' }}>Standards validation</h2>
          <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--c-text-dim)' }}>
            Automated rule checks run against the captured responses at certification
            {validations[0] ? ` · ${new Date(validations[0].validated_at).toLocaleString('en-ZA')}` : ''}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)' }}>
                  <th style={{ padding: '4px 8px', fontWeight: 500 }}>Rule</th>
                  <th style={{ padding: '4px 8px', fontWeight: 500 }}>Clause</th>
                  <th style={{ padding: '4px 8px', fontWeight: 500 }}>Result</th>
                  <th style={{ padding: '4px 8px', fontWeight: 500 }}>Measured</th>
                  <th style={{ padding: '4px 8px', fontWeight: 500 }}>Threshold</th>
                  <th style={{ padding: '4px 8px', fontWeight: 500 }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {validations.map((v) => (
                  <tr key={v.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--c-text)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v.rule_code}</span>
                      <div style={{ color: 'var(--c-text-mid)' }}>{v.rule_label}</div>
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>
                      {v.sans_clause ?? '—'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <Badge variant={VALIDATION_BADGE[v.result] ?? 'default'}>
                        {v.result.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-text-mid)' }}>{v.measured_value ?? '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-text-mid)' }}>{v.threshold ?? '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-text-dim)' }}>{v.failure_reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <SavedReportsPanel
          projectId={projectId}
          kind="inspection"
          source={{ table: 'inspections', id: inspectionId }}
          reports={savedReports}
          canManage={canManageReports}
          title="Certificate history"
        />
      </div>
    </div>
  )
}
