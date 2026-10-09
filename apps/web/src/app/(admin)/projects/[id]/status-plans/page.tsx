import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { loadStatusPlanList } from '@/lib/status-plans/plan-list'
import { statusPlanHref } from '@/lib/status-plans/plan-urls'
import { NewStatusPlanForm } from './NewStatusPlanForm'

/** The one query this page makes outside the typed schemas. */
interface ProjectReader {
  schema(name: string): {
    from(table: string): {
      select(cols: string): {
        eq(col: string, v: string): { maybeSingle(): Promise<{ data: { id: string; name: string } | null }> }
      }
    }
  }
}

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Status plans' }

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Status plans for a project (spec 2026-10-09 §7). Every project role reads;
 * owner/admin/PM create. RLS is the read gate: the list is read through the
 * caller's session, so a role that may not see a plan never sees its row.
 */
export default async function StatusPlansPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: project } = await (supabase as unknown as ProjectReader)
    .schema('projects').from('projects').select('id, name').eq('id', projectId).maybeSingle()
  if (!project) notFound()

  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  const canEdit = gate.ok
  const { rows, drawings } = await loadStatusPlanList(supabase, projectId)

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link href={`/projects/${projectId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          ← {project.name}
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Status plans</h1>
          <p className="page-subtitle">
            Shops and DB blocks drawn over the project&apos;s drawings, coloured live from the tenant schedule.
          </p>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginBottom: 16 }}>
          <NewStatusPlanForm projectId={projectId} drawings={drawings} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="data-panel" style={{ padding: 24, fontSize: 13, color: 'var(--c-text-mid)' }}>
          No status plans yet.{' '}
          {canEdit
            ? 'Press “New status plan”, pick the tenant layout drawing, and mask each shop.'
            : 'An owner, admin or project manager can create one.'}
        </div>
      ) : (
        <div className="data-panel" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)', fontSize: 11 }}>
                <th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px' }}>Drawing</th>
                <th style={{ padding: '8px 12px' }}>Page</th>
                <th style={{ padding: '8px 12px' }}>Purpose</th>
                <th style={{ padding: '8px 12px' }}>Shapes</th>
                <th style={{ padding: '8px 12px' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <Link href={statusPlanHref(projectId, r.id)} style={{ fontWeight: 600 }}>{r.name}</Link>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{r.drawingName}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{r.pageIndex}</td>
                  <td style={{ padding: '8px 12px' }}>{r.purposeLabel}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                    {r.shapes}
                    <span style={{ color: 'var(--c-text-dim)' }}>
                      {' '}· {r.linked} linked{r.purpose === 'tenant_layout' ? ` · ${r.areas} areas` : ''}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--c-text-dim)' }}>{r.updatedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
