import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { suggestShortCode } from '@/lib/cable-schedule/short-code-suggest'
import { ShortCodesForm } from './ShortCodesForm'
import { RevisionStatusBadge } from '../../RevisionStatusBadge'

export const metadata: Metadata = { title: 'Board short codes' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

interface BoardRow {
  id: string
  code: string
  short_code: string | null
}

export default async function BoardShortCodesPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  if (!project) notFound()

  const { data: revisionRow } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!revisionRow) notFound()
  const revision = revisionRow as { id: string; code: string; status: string; project_id: string }

  // structure.nodes is project-scoped (not revision-scoped); fetch all nodes
  // for this project so short codes can be edited independently of the current revision.
  const { data: boardsData } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id, code, short_code')
    .eq('project_id', projectId)
    .order('code')

  const boards = ((boardsData ?? []) as BoardRow[]).map((b) => ({
    ...b,
    suggested: suggestShortCode(b.code),
  }))

  const isDraft = revision.status === 'DRAFT'

  return (
    <div className="animate-fadeup">
      <div className="no-print" style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← {revision.code} · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Board short codes<RevisionStatusBadge status={revision.status} /></h1>
          <p className="page-subtitle">
            {revision.code} · {boards.length} board{boards.length !== 1 ? 's' : ''}
            {!isDraft && <> · read-only (revision is {revision.status})</>}
          </p>
        </div>
      </div>

      {boards.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            No boards on this revision yet.
          </div>
        </div>
      ) : (
        <ShortCodesForm
          projectId={projectId}
          revisionId={revisionId}
          isDraft={isDraft}
          boards={boards}
        />
      )}
    </div>
  )
}
