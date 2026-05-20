import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, listNodes } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { ScheduleTable } from './_components/ScheduleTable'
import { ImportFlow } from './_components/ImportFlow'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tenant Schedule' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function TenantSchedulePage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // Load all tenant_db nodes for this project — both active and decommissioned.
  // listNodes does a .schema('structure').from('nodes') SELECT (read-only via
  // cookie client; no cross-schema write gotcha for SELECTs).
  let nodes: Awaited<ReturnType<typeof listNodes>> = []
  let loadError: string | null = null

  try {
    nodes = await listNodes(supabase as never, projectId, { kind: 'tenant_db' })
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Could not load tenant schedule data'
  }

  const activeCount = nodes.filter((n) => n.status !== 'decommissioned').length
  const totalCount = nodes.length

  return (
    <div className="animate-fadeup">
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← {project.name}
        </Link>
      </div>

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant Schedule</h1>
          <p className="page-subtitle">
            {project.name}
            {totalCount > 0 && ` · ${activeCount} active shop${activeCount !== 1 ? 's' : ''}${totalCount !== activeCount ? ` (${totalCount} total)` : ''}`}
          </p>
        </div>
        <ImportFlow projectId={projectId} />
      </div>

      {/* Schema not exposed warning */}
      {loadError && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber-mid)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not load tenant data</div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
            {loadError.includes('schema') || loadError.includes('PGRST') ? (
              <>
                The <code>structure</code> schema may not be exposed via the REST API yet. Open the
                Supabase dashboard → Project Settings → API → &ldquo;Exposed schemas&rdquo; → add{' '}
                <code>structure</code> and save. Reload this page.
              </>
            ) : (
              loadError
            )}
          </div>
        </div>
      )}

      {/* Schedule table */}
      <Card>
        <CardBody>
          <ScheduleTable nodes={nodes} />
        </CardBody>
      </Card>
    </div>
  )
}
