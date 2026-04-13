import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { FloorPlanUploadButton } from './FloorPlanUploadButton'

interface Props { params: Promise<{ id: string }> }

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function FloorPlansPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const [project, plans] = await Promise.all([
    projectService.getById(supabase as any, projectId).catch(() => null),
    floorPlanService.listByProject(supabase as any, projectId).catch(() => []),
  ])
  if (!project) notFound()

  const orgId = (project as any).organisation_id as string

  // Get signed URLs for image previews (only image files)
  const plansWithUrls = await Promise.all(
    plans.map(async (plan) => {
      const isImage = /\.(png|jpe?g|webp|svg)$/i.test(plan.file_path)
      if (!isImage) return { ...plan, previewUrl: null }
      const { data } = await supabase.storage.from('drawings').createSignedUrl(plan.file_path, 3600)
      return { ...plan, previewUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <div>
      <div className="mb-6">
        <Link href={`/projects/${projectId}`} className="text-slate-400 hover:text-white text-sm">← {project.name}</Link>
      </div>

      <PageHeader
        title="Floor Plans"
        subtitle={project.name}
        actions={<FloorPlanUploadButton projectId={projectId} orgId={orgId} />}
      />

      {plansWithUrls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <p className="text-white font-semibold text-lg mb-2">No floor plans yet</p>
          <p className="text-slate-400 text-sm">Upload a drawing to start placing snags on the plan.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plansWithUrls.map((plan) => (
            <Card key={plan.id} className="overflow-hidden">
              {/* Preview */}
              <div className="h-40 bg-slate-900 flex items-center justify-center overflow-hidden">
                {plan.previewUrl ? (
                  <img
                    src={plan.previewUrl}
                    alt={plan.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-4xl">📄</div>
                )}
              </div>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-white text-sm">{plan.name}</p>
                    {plan.level && <p className="text-xs text-slate-400 mt-0.5">{plan.level}</p>}
                    <div className="flex gap-3 mt-2">
                      {plan.scale && <span className="text-xs text-slate-500">Scale: {plan.scale}</span>}
                      {plan.file_size_bytes && <span className="text-xs text-slate-500">{formatBytes(plan.file_size_bytes)}</span>}
                    </div>
                  </div>
                  {plan.previewUrl && (
                    <a
                      href={plan.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
                    >
                      Open ↗
                    </a>
                  )}
                </div>
                <p className="text-xs text-blue-400 mt-3">ID: <span className="font-mono text-slate-500 text-[10px]">{plan.id}</span></p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
