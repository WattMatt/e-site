import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService } from '@esite/shared'
import { FloorPlanUploadButton } from './FloorPlanUploadButton'
import { DrawingsList, type DrawingListItem } from './DrawingsList'

interface Props { params: Promise<{ id: string }> }

export default async function FloorPlansPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const [project, plans] = await Promise.all([
    projectService.getById(supabase as any, projectId).catch(() => null),
    floorPlanService.listByProject(supabase as any, projectId).catch(() => []),
  ])
  if (!project) notFound()

  const orgId = (project as any).organisation_id as string

  const plansWithUrls: DrawingListItem[] = await Promise.all(
    plans.map(async (plan) => {
      const isImage = /\.(png|jpe?g|webp|svg)$/i.test(plan.file_path)
      let previewUrl: string | null = null
      if (isImage) {
        const { data } = await supabase.storage.from('drawings').createSignedUrl(plan.file_path, 3600)
        previewUrl = data?.signedUrl ?? null
      }
      return {
        id: plan.id,
        name: plan.name,
        level: plan.level,
        scale: plan.scale,
        file_size_bytes: plan.file_size_bytes,
        previewUrl,
      }
    })
  )

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Floor Plans</h1>
          <p className="page-subtitle">{project.name} · {plansWithUrls.length} plan{plansWithUrls.length !== 1 ? 's' : ''}</p>
        </div>
        <FloorPlanUploadButton projectId={projectId} orgId={orgId} />
      </div>

      <DrawingsList plans={plansWithUrls} projectId={projectId} />
    </div>
  )
}
