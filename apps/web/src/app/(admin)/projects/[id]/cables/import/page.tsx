import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { ImportFlow } from './ImportFlow'

export const metadata: Metadata = { title: 'Import cable schedule from Excel' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function ImportPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← Cable revisions · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Import from Excel</h1>
          <p className="page-subtitle">
            Upload a .xlsx workbook with a CABLE SCHEDULE sheet. The
            importer reconstructs sources, boards, supplies and cables
            into a fresh DRAFT revision.
          </p>
        </div>
      </div>

      <ImportFlow projectId={projectId} projectName={project.name} />
    </div>
  )
}
