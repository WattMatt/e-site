import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { RevisionsList, type RevisionRow } from './RevisionsList'
import { CreateRevisionButton } from './CreateRevisionButton'
import { requireRole, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'

export const metadata: Metadata = { title: 'Cable schedule' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function CablesPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // The rate-library link is admin-gated (owner/admin/project_manager) to
  // match the gate on the rate-library page itself.
  const { data: orgRow } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  const canManageRates = orgRow
    ? (await requireRole(supabase, (orgRow as { organisation_id: string }).organisation_id, ROLES_ENGINEER)).ok
    : false

  // Fetch revisions. If the cable_schedule schema isn't yet exposed via
  // PostgREST (manual dashboard step), this fails cleanly and the page
  // renders the empty-state with a one-line warning.
  const { data: revisions, error: revErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, description, status, issued_at, issued_by, change_notes, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  const rows = (revisions ?? []) as unknown as RevisionRow[]
  const schemaExposed = !revErr

  return (
    <div className="animate-fadeup">
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

      <div className="page-header">
        <div>
          <h1 className="page-title">Cable schedule</h1>
          <p className="page-subtitle">
            {project.name} · {rows.length} revision{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canManageRates && (
            <Link
              href={`/projects/${projectId}/cables/rates`}
              className="btn-primary-amber"
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-border)',
                color: 'var(--c-text-mid)',
                textDecoration: 'none',
              }}
            >
              💰 Rate library
            </Link>
          )}
          <Link
            href={`/projects/${projectId}/cables/import`}
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
            }}
          >
            ⬆ Import Excel
          </Link>
          <CreateRevisionButton
            projectId={projectId}
            hasDraft={rows.some((r) => r.status === 'DRAFT')}
          />
        </div>
      </div>

      {!schemaExposed && (
        <div
          role="alert"
          className="data-panel"
          style={{
            padding: 14,
            marginBottom: 16,
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber-mid)',
            color: 'var(--c-text)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            One-time setup required
          </div>
          <div style={{ fontSize: 13 }}>
            The <code>cable_schedule</code> schema isn't exposed via the
            REST API yet. Open the Supabase dashboard → Project Settings →
            API → "Exposed schemas" → add <code>cable_schedule</code> to
            the list and save. Reload this page.
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--c-text-dim)',
              marginTop: 6,
            }}
          >
            error: {revErr?.message ?? 'unknown'}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="data-panel">
          <div
            className="data-panel-empty"
            style={{ padding: '48px 18px', textAlign: 'center' }}
          >
            ⚡ No cable-schedule revisions yet.
            <div
              style={{
                fontSize: 13,
                color: 'var(--c-text-dim)',
                marginTop: 6,
              }}
            >
              Click <strong>+ Start Rev 0</strong> above to begin modelling
              the LV/MV distribution from scratch, or <strong>⬆ Import
              Excel</strong> to load an existing cable schedule workbook.
            </div>
          </div>
        </div>
      ) : (
        <RevisionsList projectId={projectId} revisions={rows} />
      )}
    </div>
  )
}
