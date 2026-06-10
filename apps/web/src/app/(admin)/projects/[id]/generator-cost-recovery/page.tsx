import Link from 'next/link'
import { Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { hasFeatureSeat } from '@/lib/features'
import { Card, CardBody } from '@/components/ui/Card'
import { loadGcrConfigAction } from './gcr.actions'
import { listGcrReportRevisionsAction } from './gcr-reports.actions'
import { GcrTabs } from './GcrTabs'

interface Props {
  params: Promise<{ id: string }>
}

export default async function GeneratorCostRecoveryPage({ params }: Props) {
  const { id } = await params

  // ── COST_VIEW_ROLES gate (runs first, unchanged) ──────────────────────────
  const result = await loadGcrConfigAction(id)

  if ('error' in result) {
    return (
      <div className="animate-fadeup">
        <div className="page-header">
          <div>
            <h1 className="page-title">Generator Cost-Recovery</h1>
          </div>
        </div>
        <div className="data-panel">
          <div
            className="data-panel-empty"
            style={{ padding: '48px 18px', textAlign: 'center' }}
          >
            {result.error === 'Forbidden' || result.error.toLowerCase().includes('forbidden')
              ? 'You do not have permission to view generator cost-recovery for this project.'
              : 'Not found or not authorised.'}
          </div>
        </div>
      </div>
    )
  }

  // ── Seat gate ─────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: projectRow } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', id)
    .maybeSingle() as { data: { organisation_id: string } | null }

  const hasSeat = user && projectRow
    ? await hasFeatureSeat(projectRow.organisation_id, user.id, 'generator_cost_recovery', supabase)
    : false

  if (!hasSeat) {
    return (
      <div className="animate-fadeup" style={{ maxWidth: 560 }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">
              <Lock size={18} style={{ verticalAlign: -2, marginRight: 8, opacity: 0.7 }} />
              Generator Cost-Recovery
            </h1>
          </div>
        </div>

        <Card className="animate-fadeup-1">
          <CardBody>
            <p style={{ fontSize: 14, color: 'var(--c-text)', marginBottom: 6, fontWeight: 600 }}>
              Generator Cost-Recovery is a paid add-on
            </p>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 20 }}>
              R 2 000 per seat — tenant apportionment, capital cost tracking, and branded PDF report.
            </p>
            <Link
              href={`/projects/${id}/generator-cost-recovery/unlock`}
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                background: 'var(--c-accent)',
                color: '#fff',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Get access
            </Link>
          </CardBody>
        </Card>
      </div>
    )
  }

  // Saved report revisions (newest first). A load failure degrades to an empty
  // list but is flagged so the tab doesn't claim "no saved reports" when
  // revisions exist behind a transient error.
  const revisionsResult = await listGcrReportRevisionsAction(id)
  const reportRevisions = Array.isArray(revisionsResult) ? revisionsResult : []
  const revisionsLoadFailed = !Array.isArray(revisionsResult)

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Generator Cost-Recovery</h1>
          <p className="page-subtitle">
            Configure recovery rates, capital costs, and tenant assignments
          </p>
        </div>
      </div>

      <GcrTabs
        projectId={id}
        data={result}
        reportRevisions={reportRevisions}
        reportRevisionsLoadFailed={revisionsLoadFailed}
      />
    </div>
  )
}
