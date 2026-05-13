import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { RevisionsList, type RevisionRow } from './RevisionsList'
import { CreateRevisionButton } from './CreateRevisionButton'

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
        <CreateRevisionButton
          projectId={projectId}
          hasDraft={rows.some((r) => r.status === 'DRAFT')}
        />
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
              Start Rev 0 to begin modelling the LV/MV distribution. You can
              add sources, boards, supplies and cables, or import an existing
              Excel cable schedule (coming in the next slice).
            </div>
          </div>
        </div>
      ) : (
        <RevisionsList projectId={projectId} revisions={rows} />
      )}

      <div
        className="data-panel"
        style={{
          padding: 14,
          marginTop: 16,
          background: 'var(--c-base)',
          border: '1px dashed var(--c-border)',
          color: 'var(--c-text-dim)',
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--c-text)', marginBottom: 6 }}>
          Cable schedule module — what's coming
        </div>
        Phase C-1 schema is in place. Next slices land the SANS reference
        library (C-2), the AG-Grid cable schedule view (C-3), volt-drop +
        derating calculations (C-4), tag schedule + cost summary (C-5),
        diff viewer (C-6), Excel ingestion (C-7), measured-vs-confirmed
        lengths + mobile capture (C-8), Excel/PDF/CSV export (C-9), and the
        schematic distribution tree (C-10). See SPEC DOCS for the full plan.
      </div>
    </div>
  )
}
